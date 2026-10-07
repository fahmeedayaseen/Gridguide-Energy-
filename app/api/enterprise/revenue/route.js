/**
 * GET /api/enterprise/revenue — VPP earnings for devices linked to this
 * org's properties.
 *
 * EnterpriseOrg has no direct relation to RevenueTransaction/VppProgram
 * (those belong to the separate, deprecated Organization model — see
 * ENTERPRISE_ARCHITECTURE_DECISION.md). This reports something narrower
 * but real: every Device on an org property still belongs to an individual
 * User, and that user's VppPayout history is real data. This aggregates it
 * per-property rather than fabricating an "Enterprise revenue" figure that
 * doesn't map to anything this schema actually tracks at the org level.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Viewer");
  if (!access.allowed) return err(access.error, access.status);

  const org = await prisma.enterpriseOrg.findUnique({
    where: { id: access.org.id },
    include: { properties: { select: { id: true, name: true } } },
  });
  if (!org) return err("Enterprise organization not found", 404);

  const propertyIds = org.properties.map((p) => p.id);
  const devices = propertyIds.length
    ? await prisma.device.findMany({
        where: { enterprisePropertyId: { in: propertyIds } },
        select: { userId: true, enterprisePropertyId: true },
      })
    : [];

  const userIds = [...new Set(devices.map((d) => d.userId))];
  const payouts = userIds.length
    ? await prisma.vppPayout.findMany({ where: { userId: { in: userIds } }, orderBy: { createdAt: "desc" } })
    : [];

  // The org's own earned revenue share — logged by POST /api/vpp/payouts
  // whenever this org is the resolved managing partner for an event.
  const orgShareLogs = await prisma.enterpriseAuditLog.findMany({
    where: { orgId: org.id, action: "VPP_REVENUE_SHARE_PAID" },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  const totalOrgShare = orgShareLogs.reduce((a, l) => a + (l.metadata?.amount || 0), 0);

  const totalNet = payouts.reduce((a, p) => a + p.netAmount, 0);
  const totalGross = payouts.reduce((a, p) => a + p.grossAmount, 0);
  const paidOut = payouts.filter((p) => p.status === "PAID").reduce((a, p) => a + p.netAmount, 0);
  const pending = payouts.filter((p) => p.status === "PENDING").reduce((a, p) => a + p.netAmount, 0);

  return ok({
    summary: { totalGross, totalNet, paidOut, pending, payoutCount: payouts.length, participatingDevices: devices.length, totalOrgShare },
    payouts: payouts.slice(0, 25),
    orgShareHistory: orgShareLogs.map((l) => ({ eventId: l.metadata?.eventId, amount: l.metadata?.amount, participatingHomes: l.metadata?.participatingHomes, at: l.createdAt })),
    note: devices.length === 0
      ? "No devices are linked to your properties yet, or your properties' devices aren't enrolled in a VPP program."
      : null,
  });
}
