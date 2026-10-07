/**
 * GridGuide — Installer Commission Engine
 *
 * Calculates the installer's recurring monthly commission on each referred
 * homeowner subscription, using the installer's CURRENT plan tier at the
 * time of billing (not the plan they were on when the referral was made).
 *
 * Free   → 15%
 * Pro    → 25%
 * Enterprise → 30%
 *
 * Rates are admin-adjustable via PlatformConfig and read fresh each cycle.
 */
import { prisma } from "./db.js";
import { getInstallerSharePct } from "./platform-config.js";

/**
 * Calculate and record commission for a single InstallerReferral for the
 * current billing period. Safe to call multiple times — upserts on the
 * unique (installerReferralId, periodMonth, periodYear) key.
 */
export async function calculateAndRecordCommission(installerReferralId, homeownerRevenue, billingDate = new Date()) {
  const referral = await prisma.installerReferral.findUnique({
    where: { id: installerReferralId },
    include: { installer: true },
  });
  if (!referral) throw new Error(`InstallerReferral ${installerReferralId} not found`);
  if (referral.conversionStatus !== "subscribed") {
    return null; // only paying homeowners generate commission
  }

  const periodMonth = billingDate.getMonth() + 1;
  const periodYear  = billingDate.getFullYear();

  // ── Always use the installer's CURRENT plan, not a cached value ───────────
  const currentPlan = referral.installer.plan; // FREE | PRO | ENTERPRISE
  const sharePct    = await getInstallerSharePct(currentPlan);
  const commissionAmount = Math.round(homeownerRevenue * sharePct * 100) / 100;

  const ledgerRow = await prisma.installerCommissionLedger.upsert({
    where: {
      installerReferralId_periodMonth_periodYear: { installerReferralId, periodMonth, periodYear },
    },
    update: {
      planAtBilling:    currentPlan,
      sharePctApplied:  sharePct,
      homeownerRevenue,
      commissionAmount,
    },
    create: {
      installerId:         referral.installerId,
      installerReferralId,
      periodMonth, periodYear,
      planAtBilling:    currentPlan,
      sharePctApplied:  sharePct,
      homeownerRevenue,
      commissionAmount,
      status: "PENDING",
    },
  });

  // Keep the live snapshot fields on InstallerReferral up to date too
  await prisma.installerReferral.update({
    where: { id: installerReferralId },
    data: {
      monthlyRevenue: homeownerRevenue,
      installerShare: commissionAmount,
      lifetimeValue:  { increment: commissionAmount },
    },
  }).catch(() => {});

  return ledgerRow;
}

/**
 * Run commission calculation for ALL active (subscribed) installer referrals.
 * Intended to be called from a monthly cron job right after Stripe billing
 * cycles complete, or driven directly off each subscription's invoice.paid webhook.
 */
export async function runMonthlyCommissionBatch(billingDate = new Date()) {
  const activeReferrals = await prisma.installerReferral.findMany({
    where: { conversionStatus: "subscribed", verified: true },
    include: { installer: true, user: { select: { plan: true } } },
  });

  const results = [];
  for (const referral of activeReferrals) {
    try {
      // homeownerRevenue = what the homeowner is actually paying this cycle
      const revenue = referral.monthlyRevenue || 0;
      if (revenue <= 0) continue;
      const row = await calculateAndRecordCommission(referral.id, revenue, billingDate);
      if (row) results.push(row);
    } catch (e) {
      console.error(`[InstallerCommission] Failed for referral ${referral.id}:`, e.message);
    }
  }

  // Roll up totals per installer for monthlyReferralEarnings
  const byInstaller = {};
  for (const row of results) {
    byInstaller[row.installerId] = (byInstaller[row.installerId] || 0) + row.commissionAmount;
  }
  for (const [installerId, total] of Object.entries(byInstaller)) {
    await prisma.installer.update({
      where: { id: installerId },
      data:  { monthlyReferralEarnings: total },
    }).catch(() => {});
  }

  return { processedCount: results.length, totalCommission: results.reduce((a, r) => a + r.commissionAmount, 0), results };
}

/**
 * Mark a batch of commission ledger rows as paid (after Stripe transfer succeeds).
 */
export async function markCommissionsPaid(ledgerIds, stripeTransferId = null) {
  return prisma.installerCommissionLedger.updateMany({
    where: { id: { in: ledgerIds } },
    data:  { status: "PAID", paidAt: new Date(), stripeTransferId },
  });
}
