/**
 * Single source of truth for installer membership plans.
 *
 * Prices, revenue shares and lead success fees are admin-configurable through
 * PlatformConfig (membershipFee*, installerShare*, leadSuccessFee*); the
 * values below are only fallbacks if the config row can't be read.
 *
 *   Plan        Price   Referral share   Lead success fee   Trial
 *   FREE        $0      15%              10%                —
 *   PRO         $99     25%              7%                 14 days
 *   ENTERPRISE  $499    30%              5%                 — (sales-assisted pilot)
 *
 * Every route that sets or reads an installer's plan economics should use
 * these helpers instead of its own literal table.
 */
import { getPlatformConfig } from "./platform-config.js";

export const INSTALLER_PLAN_KEYS = ["FREE", "PRO", "ENTERPRISE"];

const STATIC = {
  FREE: {
    trial: null,
    vppShare: 0,
    features: ["Company profile", "Basic lead management", "Add installations", "Refer homeowners", "Basic reporting"],
  },
  PRO: {
    trial: 14,
    vppShare: 0.05,
    features: ["Everything in Free", "Priority directory placement", "Lead tracking dashboard", "Proposal tools",
      "Customer onboarding tools", "Utility interconnection tracking", "25% recurring referral revenue"],
  },
  ENTERPRISE: {
    trial: null,
    vppShare: 0.10,
    features: ["Everything in Pro", "Multi-user accounts", "Territory management", "CRM integrations",
      "White-label homeowner onboarding", "API access", "Dedicated account manager", "Bulk homeowner imports"],
  },
};

const FALLBACK = {
  FREE:       { price: 0,   shareRate: 0.15, leadSuccessFee: 0.10 },
  PRO:        { price: 99,  shareRate: 0.25, leadSuccessFee: 0.07 },
  ENTERPRISE: { price: 499, shareRate: 0.30, leadSuccessFee: 0.05 },
};

const pick = (...vals) => vals.find((v) => typeof v === "number" && Number.isFinite(v));

/** All plans with live, admin-configured economics. */
export async function getInstallerPlans() {
  let cfg = {};
  try { cfg = await getPlatformConfig(); } catch { cfg = {}; }
  const suffix = { FREE: "Free", PRO: "Pro", ENTERPRISE: "Enterprise" };
  const plans = {};
  for (const key of INSTALLER_PLAN_KEYS) {
    const s = suffix[key];
    plans[key] = {
      ...STATIC[key],
      price:          pick(cfg[`membershipFee${s}`], FALLBACK[key].price),
      shareRate:      pick(cfg[`installerShare${s}`], FALLBACK[key].shareRate),
      leadSuccessFee: pick(cfg[`leadSuccessFee${s}`], cfg[`successFee${s}`], FALLBACK[key].leadSuccessFee),
    };
  }
  return plans;
}

/** Lead success fee rate for a plan (unknown plans get the Free rate). */
export async function getLeadSuccessFeeRate(plan) {
  const plans = await getInstallerPlans();
  return (plans[plan] || plans.FREE).leadSuccessFee;
}

/**
 * Installer columns to write when a plan takes effect. Use this for every
 * plan change (checkout success, downgrade, payment failure, admin edit) so
 * plan, fee and shares can never drift apart.
 */
export async function installerPlanFields(plan) {
  const plans = await getInstallerPlans();
  const p = plans[plan] || plans.FREE;
  const key = plans[plan] ? plan : "FREE";
  return {
    plan:                 key,
    membershipMonthlyFee: p.price,
    revenueSharePct:      p.shareRate,
    vppSharePct:          p.vppShare,
    successFeeRate:       p.leadSuccessFee,
  };
}

/** Stripe subscription statuses that keep paid installer access. */
export const PAID_ACCESS_STATUSES = new Set(["active", "trialing"]);
