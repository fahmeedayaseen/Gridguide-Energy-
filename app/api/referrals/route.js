/**
 * Homeowner referral dashboard API
 * GET /api/referrals — shows referral credits earned by the logged-in user.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const [referrals, totals, user] = await Promise.all([
    prisma.homeownerReferral.findMany({
      where: { referrerId: auth.user.id },
      orderBy: { createdAt: "desc" },
      include: { referredUser: { select: { id: true, name: true, email: true, createdAt: true } } },
    }),
    prisma.homeownerReferral.aggregate({
      where: { referrerId: auth.user.id },
      _sum: { rewardPoints: true, creditAmount: true },
      _count: { id: true },
    }),
    prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { creditBalance: true, personalReferralCode: true },
    }),
  ]);

  return ok({
    summary: {
      totalSignups: totals._count.id || 0,
      totalPointsEarned: totals._sum.rewardPoints || 0,
      totalCreditsEarned: totals._sum.creditAmount || 0,
      currentCreditBalance: user?.creditBalance || 0,
      referralCode: user?.personalReferralCode || null,
    },
    referrals,
  });
}
