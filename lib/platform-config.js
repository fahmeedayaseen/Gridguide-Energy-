/**
 * GridGuide Platform Configuration
 *
 * Loads admin-adjustable rates and credit economics from the PlatformConfig
 * database table. Falls back to safe defaults if the table isn't seeded yet.
 * Results are cached in-memory for 5 minutes to avoid DB round-trips.
 */
import { prisma } from "./db.js";

let cache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const DEFAULTS = {
  // Installer revenue share by plan
  installerShareFree:         0.15,
  installerSharePro:          0.25,
  installerShareEnterprise:   0.30,

  // Installer success fee by plan
  successFeeFree:             0.10,
  successFeePro:              0.07,
  successFeeEnterprise:       0.05,

  // Installer membership monthly fee
  membershipFeeFree:          0,
  membershipFeePro:           99,
  membershipFeeEnterprise:    499,

  // Credit economics
  creditsPerDollar:            1000,  // 1,000 credits = $1.00
  homeownerReferralCredits:    2500,  // one-time award on referral subscription = $2.50
  deviceConnectCredits:         250,  // one-time award per device first connect = $0.25
  monthlyRedemptionCapCredits: 2500,  // $2.50/mo cap
  monthlyRedemptionCapDollars: 2.50,

  // Grid Fund donation
  gridFundDonationMinDollars:   1.00,  // $1.00 minimum per donation (sourced from cash wallet)
  gridFundDonationBonusPct:     0.10,  // 10% of donated $ value, paid back as credits
  // @deprecated — kept for backward-compat reads only
  gridFundDonationMinCredits:   1000,
  gridFundDonationBonusCredits: 25,

  // Homeowner subscription pricing — legacy single field
  homeownerSubscriptionPrice:  9.99,

  // ── 4-price subscription model ───────────────────────────────────────────
  plusMonthly:   9.99,
  plusAnnual:    8.29,
  proMonthly:    19.99,
  proAnnual:     16.59,

  // ── Forecast mix assumptions — never used for actual payouts ─────────────
  pctPlus:       0.70,   // 70% of subs assumed on Plus
  pctAnnual:     0.30,   // 30% of subs assumed on annual billing

  // VPP event revenue split, by installer plan tier (each tier sums to 100%)
  vppSplitFreeHomeowner:       0.80,
  vppSplitFreeGridguide:       0.20,
  vppSplitFreeInstaller:       0.00,

  vppSplitProHomeowner:        0.75,
  vppSplitProGridguide:        0.20,
  vppSplitProInstaller:        0.05,

  vppSplitEnterpriseHomeowner: 0.75,
  vppSplitEnterpriseGridguide: 0.15,
  vppSplitEnterpriseInstaller: 0.10,

  // Seller commission
  sellerCommissionFree:        0.10,
  sellerCommissionPro:         0.08,

  // Installer lead success fees (tiered by plan)
  leadSuccessFeeFree:       0.10,   // 10% for Free installers
  leadSuccessFeePro:        0.07,   // 7%  for Pro installers
  leadSuccessFeeEnterprise: 0.05,   // 5%  for Enterprise installers

  // Platform fees
  marketplaceFee:              0.03,
  withdrawalFee:               0.00,

  // Community Impact public page
  publicDonationCounterEnabled: true,          // show the page by default
  communityGoalLabel:           "Community Donation Goal",
  communityGoalTargetAmount:    100000,         // $100,000
  communityGoalStartDate:       new Date("2024-01-01"),
  donationDisplayMode:          "lifetime",     // "lifetime" | "campaign"
};

/** Get the live platform config, with in-memory cache. */
export async function getPlatformConfig() {
  const now = Date.now();
  if (cache && now < cacheExpiry) return cache;

  try {
    const row = await prisma.platformConfig.findUnique({ where: { id: "singleton" } });
    if (row) {
      cache = { ...DEFAULTS, ...row };
    } else {
      const created = await prisma.platformConfig.create({ data: { id: "singleton" } });
      cache = { ...DEFAULTS, ...created };
    }
    cacheExpiry = now + CACHE_TTL_MS;
    return cache;
  } catch (e) {
    console.error("[PlatformConfig] DB read failed, using defaults:", e.message);
    return DEFAULTS;
  }
}

/** Get installer revenue share % by plan. */
export async function getInstallerSharePct(plan) {
  const cfg = await getPlatformConfig();
  const map = { FREE: cfg.installerShareFree, PRO: cfg.installerSharePro, ENTERPRISE: cfg.installerShareEnterprise };
  return map[plan] ?? cfg.installerShareFree;
}

// ── Installer success fees — SINGLE SOURCE OF TRUTH ─────────────────────────
//
// The success fee GridGuide charges on a GridGuide-sourced installer job is
// tiered by installer plan: Free 10% · Pro 7% · Enterprise 5%. Admins can
// change these in /api/admin/rates (PlatformConfig.leadSuccessFee*).
//
// Every code path that computes, stores or displays an installer success fee
// must go through these helpers. Previously the rate was hardcoded in several
// places that disagreed (10/7/5 in config, 8/5/3 on the membership page,
// 9/6/5 on lead creation with a non-existent BASIC plan, 0.05 schema default,
// 0.08 job fallback), so installers were shown one fee and charged another.
//
// PlatformConfig also has older successFeeFree/Pro/Enterprise columns; the
// admin rates route keeps them mirrored to leadSuccessFee*, and nothing reads
// them for fee math any more.
export const INSTALLER_SUCCESS_FEE_DEFAULTS = Object.freeze({ FREE: 0.10, PRO: 0.07, ENTERPRISE: 0.05 });

function normalizeInstallerPlan(plan) {
  const p = String(plan || "").toUpperCase().replace(/^INSTALLER_/, "");
  if (p === "PRO") return "PRO";
  if (p === "ENTERPRISE" || p === "ELITE") return "ENTERPRISE";
  return "FREE"; // FREE, BASIC (legacy name), unknown
}

function validRate(v, fallback) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}

/** Current success-fee rates for every plan: { FREE, PRO, ENTERPRISE } as fractions. */
export async function getInstallerSuccessFeeRates() {
  const cfg = await getPlatformConfig();
  return {
    FREE:       validRate(cfg.leadSuccessFeeFree,       INSTALLER_SUCCESS_FEE_DEFAULTS.FREE),
    PRO:        validRate(cfg.leadSuccessFeePro,        INSTALLER_SUCCESS_FEE_DEFAULTS.PRO),
    ENTERPRISE: validRate(cfg.leadSuccessFeeEnterprise, INSTALLER_SUCCESS_FEE_DEFAULTS.ENTERPRISE),
  };
}

/** Success-fee rate (fraction) for one installer plan. */
export async function getInstallerSuccessFeeRate(plan) {
  const rates = await getInstallerSuccessFeeRates();
  return rates[normalizeInstallerPlan(plan)];
}

/** Pure helper (testable): fee in dollars, rounded to cents. Zero for self-sourced work. */
export function computeInstallerSuccessFee(projectValue, rate, { gridGuideSourced = true } = {}) {
  if (!gridGuideSourced) return 0;
  const value = Number(projectValue);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * rate * 100) / 100;
}

/** @deprecated use getInstallerSuccessFeeRate — kept so older imports keep working. */
export async function getSuccessFeePct(plan) {
  return getInstallerSuccessFeeRate(plan);
}

/**
 * Get the 3-way VPP event revenue split (homeowner / GridGuide / installer)
 * for a given installer plan tier. Each tier's values sum to 1.0 (100%).
 * Free installers get 0% of VPP event revenue but still earn referral
 * commission on the subscription itself — that's handled separately by
 * getInstallerSharePct(), not here.
 *
 * @param {"FREE"|"PRO"|"ENTERPRISE"|null} plan - pass null/undefined when
 *   there is no referring installer (e.g. organic signup). Returns the
 *   Free-tier split (default 80% homeowner / 20% GridGuide / 0% installer)
 *   since there's no installer relationship to reward. Does NOT return
 *   100% to the homeowner — GridGuide still takes its baseline platform fee.
 */
export async function getVppSplit(plan) {
  const cfg = await getPlatformConfig();

  if (!plan) {
    // No referring installer — use the Free-tier split. GridGuide still
    // takes its 20% baseline platform fee even on organic signups.
    // (The old comment saying "100% to homeowner" here was wrong — see
    // the defaults: vppSplitFreeHomeowner=0.80, vppSplitFreeGridguide=0.20)
    return {
      homeowner: cfg.vppSplitFreeHomeowner,
      gridguide: cfg.vppSplitFreeGridguide,
      installer: 0,
    };
  }

  const map = {
    FREE:       { homeowner: cfg.vppSplitFreeHomeowner,       gridguide: cfg.vppSplitFreeGridguide,       installer: cfg.vppSplitFreeInstaller },
    PRO:        { homeowner: cfg.vppSplitProHomeowner,        gridguide: cfg.vppSplitProGridguide,        installer: cfg.vppSplitProInstaller },
    ENTERPRISE: { homeowner: cfg.vppSplitEnterpriseHomeowner, gridguide: cfg.vppSplitEnterpriseGridguide, installer: cfg.vppSplitEnterpriseInstaller },
  };

  return map[plan] ?? map.FREE;
}

/** Convert a credit amount to its dollar value using the current rate. */
export async function creditsToDollars(credits) {
  const cfg = await getPlatformConfig();
  return Math.round((credits / cfg.creditsPerDollar) * 100) / 100;
}

/** Convert a dollar amount to credits using the current rate. */
export async function dollarsToCredits(dollars) {
  const cfg = await getPlatformConfig();
  return Math.round(dollars * cfg.creditsPerDollar);
}

/** Invalidate the cache — call this after admin updates rates. */
export function invalidatePlatformConfigCache() {
  cache = null;
  cacheExpiry = 0;
}

export { DEFAULTS as PLATFORM_CONFIG_DEFAULTS };
