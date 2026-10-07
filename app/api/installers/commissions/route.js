/**
 * GET /api/installers/commissions
 * Installer's recurring commission report — monthly history per referred
 * homeowner, with the plan tier and share % that was applied each cycle.
 * This is the audit trail proving commissions always use the installer's
 * CURRENT plan at time of billing, not a stale rate.
 */
import { prisma }              from "@/lib/db.js";
import { ok, err }             from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer profile not found", 404);

  const { searchParams } = new URL(request.url);
  const months = Math.min(24, parseInt(searchParams.get("months") || "12"));

  const ledger = await prisma.installerCommissionLedger.findMany({
    where:   { installerId: installer.id },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
    take:    months * 20, // generous cap across all referrals
    include: {
      referral: { include: { user: { select: { name: true, email: true } } } },
    },
  });

  // Group by period for the monthly summary chart
  const byPeriod = {};
  for (const row of ledger) {
    const key = `${row.periodYear}-${String(row.periodMonth).padStart(2, "0")}`;
    if (!byPeriod[key]) byPeriod[key] = { period: key, totalCommission: 0, activeHomeowners: 0, planBreakdown: {} };
    byPeriod[key].totalCommission += row.commissionAmount;
    byPeriod[key].activeHomeowners += 1;
    byPeriod[key].planBreakdown[row.planAtBilling] = (byPeriod[key].planBreakdown[row.planAtBilling] || 0) + 1;
  }

  const monthlySummary = Object.values(byPeriod).sort((a, b) => b.period.localeCompare(a.period));

  const lifetimeTotal = ledger.reduce((a, r) => a + r.commissionAmount, 0);
  const pendingTotal   = ledger.filter(r => r.status === "PENDING").reduce((a, r) => a + r.commissionAmount, 0);
  const paidTotal      = ledger.filter(r => r.status === "PAID").reduce((a, r) => a + r.commissionAmount, 0);

  return ok({
    currentPlan: installer.plan,
    summary: {
      lifetimeCommission: Math.round(lifetimeTotal * 100) / 100,
      pendingCommission:  Math.round(pendingTotal  * 100) / 100,
      paidCommission:     Math.round(paidTotal     * 100) / 100,
    },
    monthlySummary,
    ledger: ledger.map(r => ({
      id:               r.id,
      period:           `${r.periodYear}-${String(r.periodMonth).padStart(2, "0")}`,
      homeownerName:    r.referral.user?.name || "Homeowner",
      planAtBilling:    r.planAtBilling,
      sharePctApplied:  r.sharePctApplied,
      sharePctDisplay:  `${Math.round(r.sharePctApplied * 100)}%`,
      homeownerRevenue: r.homeownerRevenue,
      commissionAmount: r.commissionAmount,
      status:           r.status,
      paidAt:           r.paidAt,
    })),
  });
}
