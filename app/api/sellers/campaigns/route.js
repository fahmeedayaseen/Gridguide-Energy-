/**
 * GET  /api/sellers/campaigns — list campaigns with funnel stats
 * POST /api/sellers/campaigns — create draft campaign with recipients
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const campaignSchema = z.object({
  name:         z.string().min(1).max(120),
  subject:      z.string().min(1).max(180),
  bodyHtml:     z.string().min(1),
  bodyText:     z.string().optional(),
  type:         z.string().optional(),
  recipientIds: z.array(z.string()).optional(),
  scheduledAt:  z.string().datetime().optional(),
  segment:      z.object({
    marketingOptInOnly: z.literal(true).optional(),
    purchasedWithinDays: z.number().int().positive().optional(),
  }).optional(),
});

export async function GET(request) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller account not found", 404);

  const campaigns = await prisma.sellerCampaign.findMany({
    where: { sellerId: seller.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { recipients: true } } },
  });
  return ok({ campaigns });
}

export async function POST(request) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller account not found", 404);

  // Check plan limits
  const policy = await prisma.sellerCommunicationPolicy.findUnique({ where: { id: "singleton" } });
  if (policy && !policy.campaignsEnabled) return err("Seller campaigns are currently disabled by platform policy.", 403);
  const plan = (seller.plan || "FREE").toUpperCase();
  if (plan === "FREE" && policy?.freeMonthlyRecipientLimit === 0) {
    return err("Promotional campaigns are not available on the Free plan. Upgrade to Pro to send campaigns.", 403);
  }

  const { data, error } = await parseBody(request, campaignSchema);
  if (error) return err("Validation failed", 400, error);

  // Resolve recipients — always opt-in only for campaigns
  // P1-2: Implement segment filters
  const cutoff = data.segment?.purchasedWithinDays
    ? new Date(Date.now() - data.segment.purchasedWithinDays * 86400000)
    : undefined;
  const customerWhere = {
    sellerId:         seller.id,
    marketingOptIn:   true,
    marketingOptOutAt:null,
    ...(data.recipientIds?.length && { id: { in: data.recipientIds } }),
    ...(cutoff && { lastOrderAt: { gte: cutoff } }),
    ...(data.segment?.state?.length && { state: { in: data.segment.state } }),
  };
  const customers = await prisma.sellerCustomer.findMany({
    where: customerWhere,
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (customers.length === 0) return err("No eligible opted-in recipients. Only customers who have given marketing consent can receive campaigns.", 400);

  const campaign = await prisma.$transaction(async tx => {
    const camp = await tx.sellerCampaign.create({
      data: {
        sellerId:        seller.id,
        createdByUserId: auth.user.id,
        name:            data.name,
        subject:         data.subject,
        bodyHtml:        data.bodyHtml,
        bodyText:        data.bodyText,
        type:            data.type || "PROMOTIONAL_CAMPAIGN",
        status:          data.scheduledAt ? "SCHEDULED" : "DRAFT",
        scheduledAt:     data.scheduledAt ? new Date(data.scheduledAt) : null,
        recipientCount:  customers.length,
      },
    });
    await tx.sellerCampaignRecipient.createMany({
      data: customers.map(c => ({
        campaignId: camp.id, customerId: c.id, email: c.email,
        firstName: c.firstName, lastName: c.lastName,
      })),
      skipDuplicates: true,
    });
    return camp;
  });

  return ok({ campaign, recipientCount: customers.length }, 201);
}
