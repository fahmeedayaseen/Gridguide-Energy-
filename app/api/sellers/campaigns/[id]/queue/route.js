/**
 * POST /api/sellers/campaigns/[id]/queue — enqueue delivery jobs
 *
 * P0 fix: eligible is now declared BEFORE any use of eligible.length.
 * Order: load recipients → filter suppression → build eligible → check limits → queue.
 */
import { prisma }         from "@/lib/db.js";
import { ok, err }        from "@/lib/auth.js";
import { requireRole }    from "@/lib/jwt.js";
import { isSuppressed }   from "@/lib/suppression.js";

export async function POST(request, { params }) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller not found", 404);

  const campaign = await prisma.sellerCampaign.findFirst({
    where: { id: params.id, sellerId: seller.id, status: { in: ["DRAFT","SCHEDULED"] } },
  });
  if (!campaign) return err("Campaign not found or not in a queueable state", 404);

  // Step 1: load pending recipients
  const recipients = await prisma.sellerCampaignRecipient.findMany({
    where: { campaignId: campaign.id, status: "PENDING" },
    select: { id: true, email: true },
  });
  if (recipients.length === 0) return err("No pending recipients", 400);

  // Step 2: build eligible list — filter suppressed BEFORE any limit check
  const eligible = [];
  let suppressedCount = 0; // track separately — not derived from recipients.length
  for (const r of recipients) {
    const supp = await isSuppressed(r.email);
    if (supp) {
      await prisma.sellerCampaignRecipient.update({
        where: { id: r.id },
        data:  { status: "SUPPRESSED", failedAt: new Date(),
                 lastSendError: `Suppressed: ${supp.reason}`, lastAttemptAt: new Date() },
      });
      suppressedCount++;
    } else {
      eligible.push(r);
    }
  }
  if (eligible.length === 0) {
    return err("No eligible recipients remain after suppression checks.", 400);
  }

  // Step 3: plan limits — use eligible.length (declared above)
  const policy = await prisma.sellerCommunicationPolicy.findUnique({ where: { id: "singleton" } });
  if (policy && !policy.campaignsEnabled) return err("Seller campaigns are disabled by platform policy.", 403);

  const now        = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayStart   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const planKey    = (seller.plan || "FREE").toUpperCase();

  const usedThisMonth = await prisma.sellerCampaignRecipient.count({
    where: { campaign: { sellerId: seller.id }, queuedAt: { gte: monthStart }, status: { in: ["QUEUED","SENT"] } },
  });
  const monthlyLimit = planKey === "FREE"       ? (policy?.freeMonthlyRecipientLimit ?? 0)
                     : planKey === "PRO"        ? (policy?.proMonthlyRecipientLimit  ?? 5000)
                     : planKey === "ENTERPRISE" ? (policy?.enterpriseRecipientLimit  ?? null)
                     : 0;

  if (monthlyLimit !== null && usedThisMonth + eligible.length > monthlyLimit) {
    const remaining = Math.max(0, monthlyLimit - usedThisMonth);
    return err(`Monthly recipient limit exceeded. Used: ${usedThisMonth}. Requested: ${eligible.length}. Limit: ${monthlyLimit}. ${remaining} sends remaining this month on ${planKey} plan.`, 429);
  }

  const dailyLimit = policy?.maxDailyRecipients ?? 1000;
  const usedToday  = await prisma.sellerCampaignRecipient.count({
    where: { campaign: { sellerId: seller.id }, queuedAt: { gte: dayStart } },
  });
  if (usedToday + eligible.length > dailyLimit) {
    return err(`Daily recipient limit (${dailyLimit}) would be exceeded.`, 429);
  }

  // Step 4: create jobs + update campaign atomically
  await prisma.$transaction(async tx => {
    await tx.invitationDeliveryJob.createMany({
      data: eligible.map(r => ({
        invitationType: "SELLER_MESSAGE",
        invitationId:   r.id,
        campaignId:     campaign.id,
        recipientEmail: r.email,
        availableAt:    now,
      })),
      skipDuplicates: true,
    });
    await tx.sellerCampaign.update({
      where: { id: campaign.id },
      data:  { status: "QUEUED", queuedAt: now },
    });
    await tx.sellerCampaignRecipient.updateMany({
      where: { id: { in: eligible.map(r => r.id) } },
      data:  { status: "QUEUED", queuedAt: now },
    });
  });

  return ok({
    queued:     eligible.length,
    suppressed: suppressedCount,
    message:    `${eligible.length} delivery job${eligible.length !== 1 ? "s" : ""} queued — emails will process within minutes.`,
  });
}
