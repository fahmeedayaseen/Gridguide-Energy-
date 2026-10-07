/**
 * DELETE /api/enterprise/sponsorships/[id] — ends a sponsorship. Sets a
 * grace period rather than dropping the homeowner's plan immediately.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";
import { updateSponsorshipSeatQuantity } from "@/lib/stripe.js";
import { logAudit } from "@/lib/audit.js";

const GRACE_PERIOD_DAYS = 7;

export async function DELETE(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Admin");
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  const sponsorship = await prisma.enterpriseSponsorship.findUnique({ where: { id: params.id } });
  if (!sponsorship || sponsorship.orgId !== org.id) return err("Sponsorship not found", 404);
  if (sponsorship.status !== "ACTIVE") return err("This sponsorship is not active.", 409);

  const gracePeriodEndsAt = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const updated = await prisma.enterpriseSponsorship.update({
    where: { id: sponsorship.id },
    data: { status: "ENDED", endedAt: new Date(), gracePeriodEndsAt },
  });

  if (org.sponsorshipStripeItemId) {
    const remainingActive = await prisma.enterpriseSponsorship.count({ where: { orgId: org.id, status: "ACTIVE" } });
    await updateSponsorshipSeatQuantity({ subscriptionItemId: org.sponsorshipStripeItemId, quantity: remainingActive }).catch((e) => console.error("[Sponsorship] Stripe seat update failed:", e.message));
  }

  await prisma.notification.create({
    data: {
      userId: sponsorship.userId, type: "ENTERPRISE_SPONSORSHIP_ENDING", title: "Your sponsored plan is ending",
      message: `${org.name} has ended your sponsorship. Your current plan continues until ${gracePeriodEndsAt.toLocaleDateString()}.`,
      data: { orgName: org.name, gracePeriodEndsAt },
    },
  }).catch(() => {});

  await logAudit({
    actorUserId: auth.user.id, actorRole: access.role, action: "SPONSORSHIP_ENDED",
    targetType: "EnterpriseSponsorship", targetId: sponsorship.id, orgId: org.id,
    category: "BILLING", metadata: { userId: sponsorship.userId, gracePeriodEndsAt },
  });

  return ok({ sponsorship: updated, message: `Sponsorship ending. Grace period until ${gracePeriodEndsAt.toLocaleDateString()}.` });
}
