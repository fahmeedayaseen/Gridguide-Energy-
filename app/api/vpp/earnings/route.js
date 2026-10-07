import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { legacyVppGateOrNull } from "@/lib/vpp-legacy-gate.js";

// Legacy — reads VppPayout, which only the legacy /api/vpp/payouts batch
// process ever writes to. Superseded by GET /api/vpp/revenue (VppRevenueSplit),
// which is scoped to the authenticated user and reflects real partner
// settlement data. Gated behind ENABLE_LEGACY_VPP_DISPATCH.

// GET /api/vpp/earnings — homeowner's full VPP earnings history
export async function GET(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const year = searchParams.get("year") ? parseInt(searchParams.get("year")) : null;

  const where = {
    userId: auth.user.id,
    ...(year && {
      createdAt: {
        gte: new Date(`${year}-01-01`),
        lt:  new Date(`${year + 1}-01-01`),
      },
    }),
  };

  const [payouts, aggregate] = await Promise.all([
    prisma.vppPayout.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        event: { select: { name: true, program: true, utility: true, windowStart: true, windowEnd: true } },
      },
    }),
    prisma.vppPayout.aggregate({
      where:  { userId: auth.user.id },
      _sum:   { netAmount: true, grossAmount: true, fee: true, kwhDispatched: true },
      _count: { id: true },
    }),
  ]);

  // Monthly earnings breakdown for chart
  const monthly = payouts.reduce((acc, p) => {
    const month = p.createdAt.toISOString().slice(0, 7); // "2026-06"
    if (!acc[month]) acc[month] = { month, earnings: 0, kwh: 0, events: 0 };
    acc[month].earnings += p.netAmount;
    acc[month].kwh      += p.kwhDispatched;
    acc[month].events   += 1;
    return acc;
  }, {});

  // 1099 eligibility check ($600 threshold)
  const thisYear      = new Date().getFullYear();
  const thisYearTotal = payouts
    .filter(p => p.createdAt.getFullYear() === thisYear)
    .reduce((s, p) => s + p.netAmount, 0);

  return ok({
    payouts,
    summary: {
      totalEarnings:   aggregate._sum.netAmount || 0,
      totalGross:      aggregate._sum.grossAmount || 0,
      totalFeesPaid:   aggregate._sum.fee || 0,
      totalKwhDonated: aggregate._sum.kwhDispatched || 0,
      eventCount:      aggregate._count.id,
      thisYearEarnings: Math.round(thisYearTotal * 100) / 100,
      requires1099:    thisYearTotal >= 600,
    },
    monthlyBreakdown: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
  });
}
