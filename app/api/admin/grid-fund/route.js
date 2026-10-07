/**
 * GET /api/admin/grid-fund
 * Admin tracking dashboard data for the GridGuide Community Solar Fund —
 * every donation, who made it, the credit bonus awarded, and monthly totals.
 */
import { prisma }      from "@/lib/db.js";
import { ok, err }     from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const donations = await prisma.gridFundDonation.findMany({
    orderBy: { createdAt: "desc" },
    take:    500,
    include: { user: { select: { name: true, email: true } } },
  });

  const totalDonated         = donations.reduce((a, d) => a + d.amount, 0);
  const totalCreditsAwarded  = donations.reduce((a, d) => a + d.creditBonusAwarded, 0);
  const uniqueDonors         = new Set(donations.map(d => d.userId)).size;

  // Monthly trend (last 12 months)
  const byMonth = {};
  for (const d of donations) {
    const date = new Date(d.createdAt);
    const key  = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = { period: key, totalDonated: 0, donationCount: 0 };
    byMonth[key].totalDonated += d.amount;
    byMonth[key].donationCount += 1;
  }
  const monthlyTrend = Object.values(byMonth)
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, 12);

  return ok({
    summary: {
      totalDonated:        Math.round(totalDonated * 100) / 100,
      totalCreditsAwarded,
      totalDonations:      donations.length,
      uniqueDonors,
    },
    monthlyTrend,
    donations: donations.map(d => ({
      id:          d.id,
      userId:      d.userId,
      userName:    d.user?.name,
      userEmail:   d.user?.email,
      amount:      d.amount,
      creditBonus: d.creditBonusAwarded,
      createdAt:   d.createdAt,
    })),
  });
}
