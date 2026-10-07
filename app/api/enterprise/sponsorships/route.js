/**
 * GET  /api/enterprise/sponsorships — list, with seat usage vs limit
 * POST /api/enterprise/sponsorships — sponsor a homeowner's plan
 *
 * Requires the homeowner to have an ACCEPTED EnterpriseHomeownerInvite with
 * this org (Phase 2's relationship) - an org cannot sponsor an arbitrary
 * user it has no established relationship with.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";
import { updateSponsorshipSeatQuantity } from "@/lib/stripe.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const sponsorSchema = z.object({
  userId: z.string(),
  plan: z.enum(["HOMEOWNER_PLUS", "HOMEOWNER_PREMIUM"]),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Admin");
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  const sponsorships = await prisma.enterpriseSponsorship.findMany({
    where: { orgId: org.id },
    orderBy: { startedAt: "desc" },
    include: { user: { select: { name: true, email: true } } },
  });

  const activeCount = sponsorships.filter((s) => s.status === "ACTIVE").length;
  return ok({ sponsorships, seatUsage: { used: activeCount, limit: org.sponsoredSeatLimit } });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Admin");
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;
  if (!org.sponsorshipStripeSubscriptionId || !org.sponsorshipStripeItemId) {
    return err("Set up billing before sponsoring homeowners — no active subscription found.", 400);
  }

  const { data, error } = await parseBody(request, sponsorSchema);
  if (error) return err("Validation failed", 400, error);

  const activeCount = await prisma.enterpriseSponsorship.count({ where: { orgId: org.id, status: "ACTIVE" } });
  if (activeCount >= org.sponsoredSeatLimit) {
    return err(`Seat limit reached (${org.sponsoredSeatLimit}). Increase your seat limit before adding more.`, 403);
  }

  const relationship = await prisma.enterpriseHomeownerInvite.findFirst({
    where: { orgId: org.id, homeownerUserId: data.userId, status: "ACCEPTED" },
  });
  if (!relationship) return err("This homeowner has no accepted invitation with your organization. Invite them first.", 400);

  const existing = await prisma.enterpriseSponsorship.findUnique({ where: { userId: data.userId } });
  if (existing && existing.status === "ACTIVE") return err("This homeowner already has an active sponsorship.", 409);

  const sponsorship = existing
    ? await prisma.enterpriseSponsorship.update({ where: { userId: data.userId }, data: { orgId: org.id, plan: data.plan, status: "ACTIVE", startedAt: new Date(), endedAt: null, gracePeriodEndsAt: null } })
    : await prisma.enterpriseSponsorship.create({ data: { orgId: org.id, userId: data.userId, plan: data.plan } });

  await updateSponsorshipSeatQuantity({ subscriptionItemId: org.sponsorshipStripeItemId, quantity: activeCount + 1 }).catch((e) => console.error("[Sponsorship] Stripe seat update failed:", e.message));

  await prisma.notification.create({
    data: {
      userId: data.userId, type: "ENTERPRISE_SPONSORSHIP_STARTED", title: "Your plan is now sponsored",
      message: `${org.name} is now sponsoring your GridGuide ${data.plan === "HOMEOWNER_PREMIUM" ? "Premium" : "Plus"} plan.`,
      data: { orgName: org.name, plan: data.plan },
    },
  }).catch(() => {});

  await logAudit({
    actorUserId: auth.user.id, actorRole: access.role, action: "SPONSORSHIP_STARTED",
    targetType: "EnterpriseSponsorship", targetId: sponsorship.id, orgId: org.id,
    category: "BILLING", metadata: { userId: data.userId, plan: data.plan },
  });

  return ok({ sponsorship, message: "Sponsorship started." }, 201);
}
