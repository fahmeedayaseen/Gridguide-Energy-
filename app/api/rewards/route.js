/**
 * GET /api/rewards — user's points balance, tier, badges, and history.
 *
 * Redemption is exclusively through POST /api/rewards/catalog/redeem now -
 * this file previously also had a flat $0.01/point fallback redemption
 * path with its own hardcoded, non-admin-configurable conversion rate.
 * It was already unreachable from the frontend, but it was still a live,
 * callable bypass around the admin-controlled catalog. Removed rather
 * than left in place unused, since "the admin controls the economy" is
 * only true if every redemption path actually goes through what the
 * admin configured.
 *
 * Tier logic reads from the RewardTier table via lib/rewards-engine.js
 * instead of a hardcoded array duplicated in this file and
 * app/api/admin/rewards/route.js independently - that duplication was a
 * real drift risk (same values today, no shared source of truth).
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { getAllTiers } from "@/lib/rewards-engine.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const reward = await prisma.reward.findUnique({
    where:   { userId: auth.user.id },
    include: { transactions: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  if (!reward) return err("Rewards account not found", 404);

  const tiers = await getAllTiers();
  const tier = tiers.filter((t) => reward.lifetimePoints >= t.minPoints).sort((a, b) => b.minPoints - a.minPoints)[0] || tiers[0];
  const nextTier = tiers.filter((t) => t.minPoints > reward.lifetimePoints).sort((a, b) => a.minPoints - b.minPoints)[0] || null;

  const [earnedBadges, allBadges] = await Promise.all([
    prisma.userBadge.findMany({ where: { userId: auth.user.id }, include: { badge: true }, orderBy: { earnedAt: "desc" } }),
    prisma.badge.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const earnedBadgeIds = new Set(earnedBadges.map((b) => b.badgeId));
  const lockedBadges = allBadges.filter((b) => !earnedBadgeIds.has(b.id));

  return ok({
    rewards: {
      ...reward,
      tier: tier?.name || "Bronze",
      discount: tier?.discountPct || 0,
      nextTier: nextTier?.name,
      nextTierAt: nextTier?.minPoints,
      pointsToNext: nextTier ? nextTier.minPoints - reward.lifetimePoints : 0,
    },
    tiers,
    badges: {
      earned: earnedBadges.map((ub) => ({ ...ub.badge, earnedAt: ub.earnedAt })),
      locked: lockedBadges,
    },
  });
}
