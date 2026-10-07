/**
 * GET /api/installers/revenue   — revenue share history and projections
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer account not found.", 404);

  const PLAN_SHARES = { FREE: 0.15, PRO: 0.25, ENTERPRISE: 0.30 };
  const shareRate = PLAN_SHARES[installer.plan] || 0.15;

  const [revenueHistory, referralStats, vppEarnings] = await Promise.all([
    prisma.installerRevenueShare.findMany({
      where:   { installerId: installer.id },
      orderBy: { periodStart: "desc" },
      take:    12,
    }),
    prisma.installerReferral.aggregate({
      where: { installerId: installer.id },
      _count: { id: true },
      _sum:   { monthlyRevenue: true, installerShare: true, lifetimeValue: true },
    }),
    prisma.installerVppEarning.findMany({
      where:   { installerId: installer.id },
      orderBy: { createdAt: "desc" },
      take:    10,
      include: { event: { select: { windowStart: true, totalKwh: true } } },
    }),
  ]);

  const activeHomeowners = await prisma.installerReferral.count({
    where: { installerId: installer.id, conversionStatus: "subscribed", verified: true },
  });

  const HOMEOWNER_PRICE = 9.99; // matches lib/platform-config.js's homeownerSubscriptionPrice
  const projectedMonthly = activeHomeowners * HOMEOWNER_PRICE * shareRate;
  const projectedAnnual  = projectedMonthly * 12;

  return ok({
    installer: {
      plan:         installer.plan,
      shareRate:    shareRate,
      shareRatePct: Math.round(shareRate * 100),
      membershipFee: installer.membershipMonthlyFee,
      referralCode: installer.referralCode,
    },
    portfolio: {
      total:          referralStats._count.id,
      active:         activeHomeowners,
      monthlyRevenue: referralStats._sum.monthlyRevenue || 0,
      installerShare: referralStats._sum.installerShare || 0,
      lifetimeValue:  referralStats._sum.lifetimeValue  || 0,
    },
    projections: {
      monthly:  projectedMonthly,
      annual:   projectedAnnual,
      netMonthly: projectedMonthly - installer.membershipMonthlyFee,
    },
    history:  revenueHistory,
    vppEarnings,
  });
}
