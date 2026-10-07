/**
 * Admin-configurable rewards engine. Replaces the hardcoded, duplicated
 * TIERS arrays and inline point values that previously lived directly in
 * route handlers.
 *
 * AUTO badges watch the cumulative count of RewardTransaction rows whose
 * `type` matches the badge's triggerActionCode - the same events that
 * award points are what badges can watch. This is a real, bounded scope
 * decision: a badge can only watch something that's already a
 * point-earning action recorded here, not an arbitrary platform metric.
 * That's the tradeoff for not building a second, separate generic event
 * tracking system just for badges.
 */
import { prisma } from "@/lib/db.js";

export async function getTierForPoints(points) {
  const tiers = await prisma.rewardTier.findMany({ orderBy: { minPoints: "desc" } });
  return tiers.find((t) => points >= t.minPoints) || tiers[tiers.length - 1] || { name: "Bronze", minPoints: 0, discountPct: 0 };
}

export async function getAllTiers() {
  return prisma.rewardTier.findMany({ orderBy: { sortOrder: "asc" } });
}

/**
 * Recalculates and persists a reward account's tier from its current
 * lifetimePoints. Called after ANY lifetimePoints change - awardPoints,
 * badge auto-unlock bonuses, and manual badge award bonuses all earn
 * points and must all keep tier in sync, not just the main award path.
 */
async function recalculateTier(reward) {
  const newTier = await getTierForPoints(reward.lifetimePoints);
  if (newTier.name !== reward.tier) {
    await prisma.reward.update({ where: { id: reward.id }, data: { tier: newTier.name } });
  }
}

/**
 * Award points for a given action. Looks up the point value from
 * PointRule by actionCode instead of a hardcoded number - if no active
 * rule exists for that code, awards 0 and logs a warning rather than
 * throwing, so a missing/disabled rule never breaks the calling flow.
 */
export async function awardPoints(userId, actionCode, metadata = {}) {
  const rule = await prisma.pointRule.findUnique({ where: { actionCode } });
  if (!rule || !rule.isActive) {
    console.warn(`[Rewards] No active PointRule for action "${actionCode}" - awarding 0 points.`);
    return { pointsAwarded: 0, newBadges: [] };
  }

  const reward = await prisma.reward.upsert({
    where: { userId },
    update: { points: { increment: rule.points }, lifetimePoints: { increment: rule.points } },
    create: { userId, points: rule.points, lifetimePoints: rule.points },
  });

  await prisma.rewardTransaction.create({
    data: { rewardId: reward.id, points: rule.points, reason: rule.label, type: actionCode, metadata },
  });

  await recalculateTier(reward);

  const newBadges = await checkAndAwardBadges(userId, actionCode);

  return { pointsAwarded: rule.points, newBadges };
}

/**
 * Checks every active AUTO badge watching this actionCode, and awards any
 * whose threshold is now met. Safe to call repeatedly - the
 * @@unique([userId, badgeId]) constraint on UserBadge means a badge can
 * never be awarded twice to the same person.
 */
export async function checkAndAwardBadges(userId, actionCode) {
  const candidateBadges = await prisma.badge.findMany({
    where: { triggerType: "AUTO", triggerActionCode: actionCode, isActive: true },
  });
  if (candidateBadges.length === 0) return [];

  const alreadyEarned = new Set(
    (await prisma.userBadge.findMany({ where: { userId }, select: { badgeId: true } })).map((b) => b.badgeId)
  );

  const eligibleBadges = candidateBadges.filter((b) => !alreadyEarned.has(b.id));
  if (eligibleBadges.length === 0) return [];

  const actionCount = await prisma.rewardTransaction.count({
    where: { type: actionCode, reward: { userId } },
  });

  const newlyAwarded = [];
  for (const badge of eligibleBadges) {
    if (badge.triggerThreshold != null && actionCount >= badge.triggerThreshold) {
      const awarded = await prisma.userBadge.create({
        data: { userId, badgeId: badge.id },
      }).catch(() => null); // unique constraint guards against a race double-award
      if (!awarded) continue;

      if (badge.bonusPoints > 0) {
        const reward = await prisma.reward.findUnique({ where: { userId } });
        if (reward) {
          const updated = await prisma.reward.update({
            where: { id: reward.id },
            data: { points: { increment: badge.bonusPoints }, lifetimePoints: { increment: badge.bonusPoints } },
          });
          await prisma.rewardTransaction.create({
            data: { rewardId: reward.id, points: badge.bonusPoints, reason: `Badge unlocked: ${badge.name}`, type: "BADGE_BONUS", metadata: { badgeId: badge.id } },
          });
          await recalculateTier(updated);
        }
      }
      newlyAwarded.push(badge);
    }
  }
  return newlyAwarded;
}

/** Admin manually awards a badge. Robust to a race between two concurrent
 * award attempts for the same user+badge - the @@unique constraint means
 * only one create() can ever succeed; the other throws a clear, catchable
 * error here rather than a raw Prisma constraint violation surfacing as
 * an unhandled 500 further up. */
export async function awardBadgeManually(userId, badgeId, awardedByUserId) {
  const badge = await prisma.badge.findUnique({ where: { id: badgeId } });
  if (!badge) throw new Error("Badge not found");

  const userBadge = await prisma.userBadge.create({
    data: { userId, badgeId, awardedByUserId },
  }).catch((e) => {
    if (e.code === "P2002") throw new Error("This user already has this badge.");
    throw e;
  });

  if (badge.bonusPoints > 0) {
    const reward = await prisma.reward.upsert({
      where: { userId },
      update: { points: { increment: badge.bonusPoints }, lifetimePoints: { increment: badge.bonusPoints } },
      create: { userId, points: badge.bonusPoints, lifetimePoints: badge.bonusPoints },
    });
    await prisma.rewardTransaction.create({
      data: { rewardId: reward.id, points: badge.bonusPoints, reason: `Badge awarded: ${badge.name}`, type: "BADGE_BONUS", metadata: { badgeId, manual: true } },
    });
    await recalculateTier(reward);
  }

  return userBadge;
}
