/**
 * GET   /api/admin/rates  — return all platform rates (admin only)
 * PATCH /api/admin/rates  — update one or more rates (admin only)
 */
import { prisma }                        from "@/lib/db.js";
import { ok, err, parseBody }            from "@/lib/auth.js";
import { requireRole }                   from "@/lib/jwt.js";
import { getPlatformConfig,
         invalidatePlatformConfigCache } from "@/lib/platform-config.js";
import { z }                             from "zod";

const rateSchema = z.object({
  // Installer revenue share by plan
  installerShareFree:          z.number().min(0).max(1).optional(),
  installerSharePro:           z.number().min(0).max(1).optional(),
  installerShareEnterprise:    z.number().min(0).max(1).optional(),
  // Lead success fees by plan
  leadSuccessFeeFree:          z.number().min(0).max(1).optional(),
  leadSuccessFeePro:           z.number().min(0).max(1).optional(),
  leadSuccessFeeEnterprise:    z.number().min(0).max(1).optional(),
  // Installer success fee by plan
  successFeeFree:              z.number().min(0).max(1).optional(),
  successFeePro:               z.number().min(0).max(1).optional(),
  successFeeEnterprise:        z.number().min(0).max(1).optional(),
  // Installer membership fees
  membershipFeeFree:           z.number().min(0).optional(),
  membershipFeePro:            z.number().min(0).optional(),
  membershipFeeEnterprise:     z.number().min(0).optional(),
  // Credit economics
  creditsPerDollar:            z.number().int().min(1).optional(),
  homeownerReferralCredits:    z.number().int().min(0).optional(),
  monthlyRedemptionCapCredits: z.number().int().min(0).optional(),
  monthlyRedemptionCapDollars: z.number().min(0).optional(),
  // Grid Fund donation
  gridFundDonationMinDollars:  z.number().min(0).optional(),
  gridFundDonationBonusPct:    z.number().min(0).max(1).optional(),
  // Subscription pricing — legacy field
  homeownerSubscriptionPrice:  z.number().min(0).optional(),
  // Subscription pricing — 4-price model
  plusMonthly:   z.number().min(0).optional(),
  plusAnnual:    z.number().min(0).optional(),
  proMonthly:    z.number().min(0).optional(),
  proAnnual:     z.number().min(0).optional(),
  // Forecast mix assumptions (UI sends 0-100 int; stored as 0.0-1.0 float)
  pctPlus:   z.number().min(0).max(100).optional(),
  pctAnnual: z.number().min(0).max(100).optional(),
  // VPP splits
  vppSplitFreeHomeowner:       z.number().min(0).max(1).optional(),
  vppSplitFreeGridguide:       z.number().min(0).max(1).optional(),
  vppSplitFreeInstaller:       z.number().min(0).max(1).optional(),
  vppSplitProHomeowner:        z.number().min(0).max(1).optional(),
  vppSplitProGridguide:        z.number().min(0).max(1).optional(),
  vppSplitProInstaller:        z.number().min(0).max(1).optional(),
  vppSplitEnterpriseHomeowner: z.number().min(0).max(1).optional(),
  vppSplitEnterpriseGridguide: z.number().min(0).max(1).optional(),
  vppSplitEnterpriseInstaller: z.number().min(0).max(1).optional(),
  // Seller commission
  sellerCommissionFree:        z.number().min(0).max(1).optional(),
  sellerCommissionPro:         z.number().min(0).max(1).optional(),
  // Platform fees
  marketplaceFee:              z.number().min(0).max(1).optional(),
  withdrawalFee:               z.number().min(0).optional(),
}).strict();

// ── Helper: build the full rates response object from a config ────────────────
function buildRatesResponse(cfg) {
  return {
    installer: {
      revenueShare: {
        free:       { pct: cfg.installerShareFree,       display: `${Math.round(cfg.installerShareFree       * 100)}%` },
        pro:        { pct: cfg.installerSharePro,        display: `${Math.round(cfg.installerSharePro        * 100)}%` },
        enterprise: { pct: cfg.installerShareEnterprise, display: `${Math.round(cfg.installerShareEnterprise * 100)}%` },
      },
      leadSuccessFees: {
        free:       { pct: cfg.leadSuccessFeeFree       ?? 0.10, display: `${Math.round((cfg.leadSuccessFeeFree       ?? 0.10) * 100)}%` },
        pro:        { pct: cfg.leadSuccessFeePro        ?? 0.07, display: `${Math.round((cfg.leadSuccessFeePro        ?? 0.07) * 100)}%` },
        enterprise: { pct: cfg.leadSuccessFeeEnterprise ?? 0.05, display: `${Math.round((cfg.leadSuccessFeeEnterprise ?? 0.05) * 100)}%` },
      },
      successFee: {
        free:       { pct: cfg.successFeeFree,       display: `${Math.round(cfg.successFeeFree       * 100)}%` },
        pro:        { pct: cfg.successFeePro,        display: `${Math.round(cfg.successFeePro        * 100)}%` },
        enterprise: { pct: cfg.successFeeEnterprise, display: `${Math.round(cfg.successFeeEnterprise * 100)}%` },
      },
      membershipFee: {
        free:       cfg.membershipFeeFree,
        pro:        cfg.membershipFeePro,
        enterprise: cfg.membershipFeeEnterprise,
      },
    },
    credits: {
      creditsPerDollar:            cfg.creditsPerDollar,
      creditsPerDollarDisplay:     `${cfg.creditsPerDollar.toLocaleString()} credits = $1.00`,
      homeownerReferralCredits:    cfg.homeownerReferralCredits,
      homeownerReferralDisplay:    `${cfg.homeownerReferralCredits.toLocaleString()} credits ($${(cfg.homeownerReferralCredits / cfg.creditsPerDollar).toFixed(2)})`,
      monthlyRedemptionCapCredits: cfg.monthlyRedemptionCapCredits,
      monthlyRedemptionCapDollars: cfg.monthlyRedemptionCapDollars,
      monthlyRedemptionCapDisplay: `${cfg.monthlyRedemptionCapCredits.toLocaleString()} credits / $${cfg.monthlyRedemptionCapDollars.toFixed(2)} per month`,
    },
    gridFundDonation: {
      minDollars:   cfg.gridFundDonationMinDollars,
      minDisplay:   `$${cfg.gridFundDonationMinDollars.toFixed(2)} minimum`,
      bonusPct:     cfg.gridFundDonationBonusPct,
      bonusDisplay: `${Math.round(cfg.gridFundDonationBonusPct * 100)}% back as credits`,
    },
    subscription: {
      homeownerSubscriptionPrice: cfg.homeownerSubscriptionPrice,
      plusMonthly:  cfg.plusMonthly  ?? 9.99,
      plusAnnual:   cfg.plusAnnual   ?? 8.29,
      proMonthly:   cfg.proMonthly   ?? 19.99,
      proAnnual:    cfg.proAnnual    ?? 16.59,
      pctPlus:      Math.round((cfg.pctPlus   ?? 0.70) * 100),  // 0.70 → 70 for UI
      pctAnnual:    Math.round((cfg.pctAnnual ?? 0.30) * 100),  // 0.30 → 30 for UI
    },
    vpp: {
      free:       {
        homeowner: { pct: cfg.vppSplitFreeHomeowner, display: `${Math.round(cfg.vppSplitFreeHomeowner * 100)}%` },
        gridguide: { pct: cfg.vppSplitFreeGridguide, display: `${Math.round(cfg.vppSplitFreeGridguide * 100)}%` },
        installer: { pct: cfg.vppSplitFreeInstaller, display: `${Math.round(cfg.vppSplitFreeInstaller * 100)}%` },
      },
      pro:        {
        homeowner: { pct: cfg.vppSplitProHomeowner, display: `${Math.round(cfg.vppSplitProHomeowner * 100)}%` },
        gridguide: { pct: cfg.vppSplitProGridguide, display: `${Math.round(cfg.vppSplitProGridguide * 100)}%` },
        installer: { pct: cfg.vppSplitProInstaller, display: `${Math.round(cfg.vppSplitProInstaller * 100)}%` },
      },
      enterprise: {
        homeowner: { pct: cfg.vppSplitEnterpriseHomeowner, display: `${Math.round(cfg.vppSplitEnterpriseHomeowner * 100)}%` },
        gridguide: { pct: cfg.vppSplitEnterpriseGridguide, display: `${Math.round(cfg.vppSplitEnterpriseGridguide * 100)}%` },
        installer: { pct: cfg.vppSplitEnterpriseInstaller, display: `${Math.round(cfg.vppSplitEnterpriseInstaller * 100)}%` },
      },
    },
    seller: {
      commissionFree: { pct: cfg.sellerCommissionFree, display: `${Math.round(cfg.sellerCommissionFree * 100)}%` },
      commissionPro:  { pct: cfg.sellerCommissionPro,  display: `${Math.round(cfg.sellerCommissionPro  * 100)}%` },
    },
    platform: {
      marketplaceFee: { pct: cfg.marketplaceFee, display: `${Math.round(cfg.marketplaceFee * 100)}%` },
      withdrawalFee:  cfg.withdrawalFee,
    },
  };
}

// ── GET — return current rates (admin only) ───────────────────────────────────
export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const config = await getPlatformConfig();

  return ok({
    rates:         buildRatesResponse(config),
    lastUpdated:   config.updatedAt ?? null,
    lastUpdatedBy: config.updatedBy ?? null,
  });
}

// ── GET /api/admin/rates/public — read-only subset for installer/enterprise ───
// This is a separate route file: app/api/rates/public/route.js
// (created below separately)

// ── PATCH — update one or more rates (admin only) ─────────────────────────────
export async function PATCH(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, rateSchema);
  if (error) return err("Validation failed", 400, error);

  if (Object.keys(data).length === 0) {
    return err("No rates provided to update", 400);
  }

  const current = await prisma.platformConfig.findUnique({ where: { id: "singleton" } });

  // Validate VPP splits sum to 100% when any tier field is changed
  const vppTiers = [
    { prefix: "vppSplitFree",       label: "Free" },
    { prefix: "vppSplitPro",        label: "Pro" },
    { prefix: "vppSplitEnterprise", label: "Enterprise" },
  ];
  for (const { prefix, label } of vppTiers) {
    const hKey = `${prefix}Homeowner`, gKey = `${prefix}Gridguide`, iKey = `${prefix}Installer`;
    if (data[hKey] !== undefined || data[gKey] !== undefined || data[iKey] !== undefined) {
      const h = data[hKey] ?? current?.[hKey] ?? 0;
      const g = data[gKey] ?? current?.[gKey] ?? 0;
      const i = data[iKey] ?? current?.[iKey] ?? 0;
      const total = Math.round((h + g + i) * 1000) / 1000;
      if (total !== 1) return err(`${label} VPP split must total 100%. Got ${Math.round(total * 100)}%.`, 400);
    }
  }

  // Normalize pctPlus/pctAnnual: UI sends 0-100 int, DB stores 0.0-1.0 float
  if (data.pctPlus   !== undefined) data.pctPlus   = data.pctPlus   / 100;
  if (data.pctAnnual !== undefined) data.pctAnnual = data.pctAnnual / 100;

  // Keep monthly redemption cap credits and dollars in sync
  if (data.monthlyRedemptionCapCredits !== undefined && data.monthlyRedemptionCapDollars === undefined) {
    const cpd = data.creditsPerDollar ?? current?.creditsPerDollar ?? 1000;
    data.monthlyRedemptionCapDollars = Math.round((data.monthlyRedemptionCapCredits / cpd) * 100) / 100;
  }
  if (data.monthlyRedemptionCapDollars !== undefined && data.monthlyRedemptionCapCredits === undefined) {
    const cpd = data.creditsPerDollar ?? current?.creditsPerDollar ?? 1000;
    data.monthlyRedemptionCapCredits = Math.round(data.monthlyRedemptionCapDollars * cpd);
  }

  await prisma.platformConfig.upsert({
    where:  { id: "singleton" },
    update: { ...data, updatedBy: auth.user.id },
    create: { id: "singleton", ...data, updatedBy: auth.user.id },
  });

  await invalidatePlatformConfigCache();

  const changedKeys = Object.keys(data);
  await prisma.userActivityLog.create({
    data: {
      userId:   auth.user.id,
      action:   "ADMIN_RATE_UPDATE",
      metadata: JSON.stringify({ changed: changedKeys, values: data }),
    },
  }).catch(() => {});

  // Return fresh config after save
  const updated = await getPlatformConfig();
  return ok({
    message:     `Updated ${changedKeys.length} rate(s): ${changedKeys.join(", ")}`,
    updated:     changedKeys,
    rates:       buildRatesResponse(updated),
    effectiveAt: new Date().toISOString(),
  });
}
