/**
 * Configurable VPP revenue-split resolution.
 *
 * Replaces hardcoded percentages with a real rule table (VppRevenueRule)
 * that an admin manages via /api/admin/vpp-revenue-rules — different
 * enterprise partners, installers, VPP programs, or utilities can each have
 * their own negotiated split without a code change.
 *
 * Precedence, most to least specific:
 *   1. A rule matching the identified partner (enterpriseOrgId or
 *      installerId) exactly, optionally further narrowed by program/utility.
 *   2. A rule matching only program/utility (no partner scoping) — a
 *      program- or utility-wide default.
 *   3. A fully generic rule (no scope at all) — the platform default.
 *   4. If no rule exists at all: a hardcoded fallback (see FALLBACK_* below),
 *      so the system never divides by an undefined split.
 *
 * Partner identification precedence when a homeowner could match more than
 * one: an Enterprise property affiliation takes precedence over an
 * installer referral, since the enterprise org is the one managing that
 * property relationship. Admins can still write an explicit installer-scoped
 * rule to override this for a specific case.
 */
import { prisma } from "@/lib/db.js";
import { getVppSplit } from "@/lib/platform-config.js";

// Used only when NO VppRevenueRule exists for an enterprise-affiliated
// homeowner at all (first time this runs before an admin has configured
// anything). Matches the split specified when this feature was designed:
// homeowner gets the strong majority, GridGuide takes a platform fee,
// the managing partner gets a smaller share for enrollment/management.
// FALLBACK_NO_PARTNER matches the current organic-homeowner default (see
// lib/platform-config.js getVppSplit, used by the current partner-based
// system) — GridGuide's share is 20%, not the old flat 10%.
const FALLBACK_WITH_PARTNER    = { homeownerPct: 0.75, gridguidePct: 0.15, partnerPct: 0.10 };
const FALLBACK_NO_PARTNER      = { homeownerPct: 0.80, gridguidePct: 0.20, partnerPct: 0 };

/** Identify which partner (if any) manages this homeowner's participation. */
async function identifyPartner(userId) {
  const deviceOnEnterpriseProperty = await prisma.device.findFirst({
    where: { userId, enterprisePropertyId: { not: null } },
    include: { enterpriseProperty: { select: { orgId: true } } },
  });
  if (deviceOnEnterpriseProperty?.enterpriseProperty?.orgId) {
    return { partnerType: "ENTERPRISE", partnerId: deviceOnEnterpriseProperty.enterpriseProperty.orgId };
  }

  const activeReferral = await prisma.installerReferral.findFirst({
    where: { userId, conversionStatus: { in: ["subscribed", "activated"] }, verified: true },
    orderBy: { referredAt: "desc" },
    select: { installerId: true },
  });
  if (activeReferral?.installerId) {
    return { partnerType: "INSTALLER", partnerId: activeReferral.installerId };
  }

  return { partnerType: null, partnerId: null };
}

function specificity(rule, partnerType, partnerId, vppProgram, utility) {
  let score = 0;
  if (partnerType === "ENTERPRISE" && rule.enterpriseOrgId === partnerId) score += 10;
  if (partnerType === "INSTALLER" && rule.installerId === partnerId) score += 10;
  if (rule.vppProgram && rule.vppProgram === vppProgram) score += 1;
  if (rule.utility && rule.utility === utility) score += 1;
  return score;
}

/**
 * Resolve the revenue split for one homeowner's participation in one VPP
 * event. Returns { homeownerPct, gridguidePct, partnerPct, partnerType,
 * partnerId, partnerUserId, source } where source is "rule:<id>",
 * "fallback_with_partner", "fallback_no_partner", or "legacy_installer_plan"
 * (only when an installer partner exists and predates any rule — preserves
 * the pre-existing plan-tier behavior rather than silently changing already
 * negotiated installer economics the moment this feature ships).
 */
export async function resolveVppRevenueSplit({ userId, vppProgram, utility }) {
  const { partnerType, partnerId } = await identifyPartner(userId);

  // Only rules that could plausibly apply: unscoped, or scoped to this
  // exact partner. A rule scoped to a *different* partner never matches.
  const candidateRules = await prisma.vppRevenueRule.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ enterpriseOrgId: null }, { enterpriseOrgId: partnerType === "ENTERPRISE" ? partnerId : "__none__" }] },
        { OR: [{ installerId: null }, { installerId: partnerType === "INSTALLER" ? partnerId : "__none__" }] },
        { OR: [{ vppProgram: null }, { vppProgram }] },
        { OR: [{ utility: null }, { utility }] },
      ],
    },
  });

  if (candidateRules.length > 0) {
    const best = candidateRules
      .map((r) => ({ rule: r, score: specificity(r, partnerType, partnerId, vppProgram, utility) }))
      .sort((a, b) => b.score - a.score || b.rule.priority - a.rule.priority)[0].rule;

    const partnerUserId = await resolvePartnerUserId(partnerType, partnerId);
    return {
      homeownerPct: best.homeownerPct, gridguidePct: best.gridguidePct, partnerPct: best.partnerPct,
      partnerType, partnerId, partnerUserId, source: `rule:${best.id}`,
    };
  }

  // No rule configured yet — fall back.
  if (partnerType === "INSTALLER") {
    // Preserve existing installer-plan-tier behavior rather than silently
    // changing already-negotiated installer economics on rollout.
    const installer = await prisma.installer.findUnique({ where: { id: partnerId }, select: { plan: true, userId: true } });
    const split = await getVppSplit(installer?.plan ?? null);
    return {
      homeownerPct: split.homeowner, gridguidePct: split.gridguide, partnerPct: split.installer,
      partnerType, partnerId, partnerUserId: installer?.userId ?? null, source: "legacy_installer_plan",
    };
  }

  if (partnerType === "ENTERPRISE") {
    const partnerUserId = await resolvePartnerUserId(partnerType, partnerId);
    return { ...FALLBACK_WITH_PARTNER, partnerType, partnerId, partnerUserId, source: "fallback_with_partner" };
  }

  return { ...FALLBACK_NO_PARTNER, partnerType: null, partnerId: null, partnerUserId: null, source: "fallback_no_partner" };
}

async function resolvePartnerUserId(partnerType, partnerId) {
  if (!partnerId) return null;
  if (partnerType === "ENTERPRISE") {
    const org = await prisma.enterpriseOrg.findUnique({ where: { id: partnerId }, select: { ownerUserId: true } });
    return org?.ownerUserId ?? null;
  }
  if (partnerType === "INSTALLER") {
    const installer = await prisma.installer.findUnique({ where: { id: partnerId }, select: { userId: true } });
    return installer?.userId ?? null;
  }
  return null;
}
