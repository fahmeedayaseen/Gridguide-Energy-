/**
 * GET /api/admin/referrals/analytics
 * Admin reporting dashboard data for BOTH referral programs:
 *  - Homeowner-to-homeowner (credit-based)
 *  - Installer-to-homeowner (recurring commission)
 */
import { prisma }      from "@/lib/db.js";
import { ok, err }     from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  // ── Homeowner referral program stats ────────────────────────────────────
  const [
    totalHomeownerReferrals,
    homeownerReferralsByStatus,
    totalCreditsAwarded,
    totalCreditsRedeemed,
    totalRedemptionDollars,
  ] = await Promise.all([
    prisma.homeownerReferral.count(),
    prisma.homeownerReferral.groupBy({ by: ["status"], _count: true }),
    prisma.creditTransaction.aggregate({ where: { amount: { gt: 0 } }, _sum: { amount: true } }),
    prisma.creditTransaction.aggregate({ where: { amount: { lt: 0 } }, _sum: { amount: true } }),
    prisma.creditRedemption.aggregate({ _sum: { dollarValue: true } }),
  ]);

  // ── Installer referral program stats ────────────────────────────────────
  const [
    totalInstallerReferrals,
    installerReferralsByStatus,
    commissionByPlan,
    lifetimeCommissionPaid,
    pendingCommission,
    topInstallers,
  ] = await Promise.all([
    prisma.installerReferral.count(),
    prisma.installerReferral.groupBy({ by: ["conversionStatus"], _count: true }),
    prisma.installerCommissionLedger.groupBy({
      by: ["planAtBilling"],
      _count: true,
      _sum: { commissionAmount: true },
    }),
    prisma.installerCommissionLedger.aggregate({ where: { status: "PAID" }, _sum: { commissionAmount: true } }),
    prisma.installerCommissionLedger.aggregate({ where: { status: "PENDING" }, _sum: { commissionAmount: true } }),
    prisma.installer.findMany({
      where:   { totalReferredUsers: { gt: 0 } },
      orderBy: { monthlyReferralEarnings: "desc" },
      take:    10,
      select:  { id: true, companyName: true, plan: true, totalReferredUsers: true, monthlyReferralEarnings: true, lifetimeReferralEarnings: true },
    }),
  ]);

  return ok({
    homeownerProgram: {
      totalReferrals: totalHomeownerReferrals,
      byStatus: Object.fromEntries(homeownerReferralsByStatus.map(s => [s.status, s._count])),
      totalCreditsAwarded:   totalCreditsAwarded._sum.amount || 0,
      totalCreditsRedeemed:  Math.abs(totalCreditsRedeemed._sum.amount || 0),
      totalRedemptionDollars: totalRedemptionDollars._sum.dollarValue || 0,
    },
    installerProgram: {
      totalReferrals: totalInstallerReferrals,
      byStatus: Object.fromEntries(installerReferralsByStatus.map(s => [s.conversionStatus, s._count])),
      commissionByPlan: commissionByPlan.map(p => ({
        plan: p.planAtBilling,
        referralCount: p._count,
        totalCommission: p._sum.commissionAmount || 0,
      })),
      lifetimeCommissionPaid: lifetimeCommissionPaid._sum.commissionAmount || 0,
      pendingCommission:      pendingCommission._sum.commissionAmount || 0,
      topInstallers: topInstallers.map(i => ({
        id: i.id, company: i.companyName, plan: i.plan,
        totalReferrals: i.totalReferredUsers,
        monthlyEarnings: i.monthlyReferralEarnings,
        lifetimeEarnings: i.lifetimeReferralEarnings,
      })),
    },
  });
}
