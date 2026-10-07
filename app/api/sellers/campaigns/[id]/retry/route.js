import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { isSuppressed } from "@/lib/suppression.js";
import { z } from "zod";

export async function POST(request, { params }) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller not found", 404);

  const body = await request.json().catch(() => ({}));
  const campaign = await prisma.sellerCampaign.findFirst({
    where: { id: params.id, sellerId: seller.id },
  });
  if (!campaign) return err("Campaign not found", 404);

  const failedWhere = {
    campaignId: campaign.id,
    status: { in: ["FAILED"] },
    ...(body.recipientIds?.length && { id: { in: body.recipientIds } }),
  };
  const failed = await prisma.sellerCampaignRecipient.findMany({
    where: failedWhere, select: { id: true, email: true },
  });

  let requeued = 0, suppressed = 0;
  for (const r of failed) {
    const supp = await isSuppressed(r.email);
    if (supp) {
      // P1: mark recipient SUPPRESSED — don't just skip, update status for UI clarity
      await prisma.sellerCampaignRecipient.update({
        where: { id: r.id },
        data:  { status: "SUPPRESSED", failedAt: new Date(),
                 lastSendError: `Suppressed: ${supp.reason}`, lastAttemptAt: new Date() },
      }); // no silent catch — failure propagates so retry counts remain accurate
      suppressed++;
      continue;
    }
    await prisma.invitationDeliveryJob.upsert({
      where:  { invitationType_invitationId_campaignId: { invitationType: "SELLER_MESSAGE", invitationId: r.id, campaignId: campaign.id } },
      create: { invitationType: "SELLER_MESSAGE", invitationId: r.id, campaignId: campaign.id, recipientEmail: r.email, availableAt: new Date() },
      update: { status: "PENDING", availableAt: new Date(), lastError: null },
    });
    await prisma.sellerCampaignRecipient.update({ where: { id: r.id }, data: { status: "QUEUED", failedAt: null, lastSendError: null } });
    requeued++;
  }

  return ok({ requeued, suppressed, total: failed.length });
}
