import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

export async function GET(request, { params }) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller not found", 404);

  const campaign = await prisma.sellerCampaign.findFirst({
    where: { id: params.id, sellerId: seller.id },
    include: { recipients: { select: { email:true, status:true, sentAt:true, openedAt:true, clickedAt:true, failedAt:true, lastSendError:true } } },
  });
  if (!campaign) return err("Campaign not found", 404);

  const funnel = {
    total:     campaign.recipients.length,
    sent:      campaign.recipients.filter(r=>r.sentAt).length,
    opened:    campaign.recipients.filter(r=>r.openedAt).length,
    clicked:   campaign.recipients.filter(r=>r.clickedAt).length,
    failed:    campaign.recipients.filter(r=>r.failedAt).length,
  };
  return ok({ campaign, funnel });
}
