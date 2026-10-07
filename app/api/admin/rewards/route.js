/**
 * GET /api/admin/rewards — platform-wide rewards program overview.
 * GET /api/admin/rewards?search=email — look up one user's rewards account.
 *
 * Tier logic now reads from the RewardTier table via
 * lib/rewards-engine.js instead of a hardcoded array duplicated here and
 * in app/api/rewards/route.js independently - that duplication was a
 * real drift risk. tierCounts is also built dynamically from whatever
 * tiers actually exist now, rather than a hardcoded 4-entry object that
 * would silently stop matching reality the moment an admin renamed or
 * added a tier through the new CRUD.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { getTierForPoints, getAllTiers } from "@/lib/rewards-engine.js";

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search");

  if (search) {
    const reward = await prisma.reward.findFirst({
      where: { user: { email: { contains: search, mode: "insensitive" } } },
      include: {
        user: { select: { name: true, email: true } },
        transactions: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!reward) return err("No rewards account found for that email.", 404);
    const tier = await getTierForPoints(reward.lifetimePoints);
    return ok({ account: { ...reward, tier: tier.name } });
  }

  const [totalAccounts, pointsAgg, redeemedAgg, allRewards, tiers] = await Promise.all([
    prisma.reward.count(),
    prisma.reward.aggregate({ _sum: { lifetimePoints: true } }),
    prisma.rewardTransaction.aggregate({ where: { points: { lt: 0 } }, _sum: { points: true } }),
    prisma.reward.findMany({ select: { lifetimePoints: true } }),
    getAllTiers(),
  ]);

  const tierCounts = Object.fromEntries(tiers.map((t) => [t.name, 0]));
  const sortedTiers = [...tiers].sort((a, b) => b.minPoints - a.minPoints);
  for (const r of allRewards) {
    const match = sortedTiers.find((t) => r.lifetimePoints >= t.minPoints) || sortedTiers[sortedTiers.length - 1];
    if (match) tierCounts[match.name] = (tierCounts[match.name] || 0) + 1;
  }

  const totalRedeemedPoints = Math.abs(redeemedAgg._sum.points || 0);

  return ok({
    overview: {
      totalAccounts,
      totalLifetimePointsIssued: pointsAgg._sum.lifetimePoints || 0,
      totalPointsRedeemed: totalRedeemedPoints,
      totalRedeemedValue: totalRedeemedPoints * 0.01, // matches POINT_VALUE in /api/rewards
      tierDistribution: tierCounts,
    },
  });
}
