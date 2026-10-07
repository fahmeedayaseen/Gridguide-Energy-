import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { cacheGet, cacheSet } from "@/lib/redis.js";

// GET /api/admin/analytics — platform analytics dashboard
export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "month"; // week|month|quarter|year

  const cacheKey = `analytics:${period}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return ok(cached);

  const now    = new Date();
  const ranges = {
    week:    new Date(now - 7  * 86400000),
    month:   new Date(now - 30 * 86400000),
    quarter: new Date(now - 90 * 86400000),
    year:    new Date(now - 365 * 86400000),
  };
  const since = ranges[period] || ranges.month;

  const [
    totalUsers, newUsers,
    totalSellers, verifiedSellers,
    totalInstallers, verifiedInstallers,
    activeProducts,
    ordersData,
    vppPayoutsData,
    installerPayoutsData,
    sellerPayoutsData,
    proUsers,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.seller.count(),
    prisma.seller.count({ where: { verificationStatus: "VERIFIED" } }),
    prisma.installer.count(),
    prisma.installer.count({ where: { verificationStatus: "VERIFIED" } }),
    prisma.product.count({ where: { status: "ACTIVE" } }),

    // Revenue from marketplace orders
    prisma.order.aggregate({
      where:  { status: "PAID", createdAt: { gte: since } },
      _sum:   { commission: true, total: true },
      _count: { id: true },
    }),

    // VPP platform fees
    prisma.vppPayout.aggregate({
      where:  { status: "PAID", createdAt: { gte: since } },
      _sum:   { fee: true, netAmount: true },
      _count: { id: true },
    }),

    // Installer success fees
    prisma.installerPayout.aggregate({
      where:  { status: "PAID", createdAt: { gte: since } },
      _sum:   { successFee: true, projectValue: true },
      _count: { id: true },
    }),

    // Seller payouts (shows volume)
    prisma.sellerPayout.aggregate({
      where:  { status: "PAID", createdAt: { gte: since } },
      _sum:   { commission: true, netAmount: true },
    }),

    // Pro plan users
    prisma.user.count({ where: { plan: "HOMEOWNER_PLUS" } }),
  ]);

  // Revenue breakdown
  const marketplaceRevenue  = ordersData._sum.commission || 0;
  const vppRevenue          = vppPayoutsData._sum.fee || 0;
  const installerFeeRevenue = installerPayoutsData._sum.successFee || 0;
  const totalRevenue        = marketplaceRevenue + vppRevenue + installerFeeRevenue;

  // Estimate MRR (monthly recurring from Pro plans)
  const PRO_PRICE = 9.99;
  const MRR = proUsers * PRO_PRICE;

  // Monthly revenue per period for chart (last 12 months)
  const monthlyRevenue = await prisma.$queryRaw`
    SELECT
      DATE_TRUNC('month', created_at) AS month,
      SUM(commission) AS revenue
    FROM orders
    WHERE status = 'PAID' AND created_at >= NOW() - INTERVAL '12 months'
    GROUP BY month
    ORDER BY month ASC
  `;

  const result = {
    period,
    users: {
      total: totalUsers, new: newUsers, pro: proUsers,
      sellers: totalSellers, verifiedSellers,
      installers: totalInstallers, verifiedInstallers,
    },
    products: { active: activeProducts },
    revenue: {
      total:     totalRevenue,
      MRR,
      ARR:       MRR * 12,
      ARPU:      proUsers > 0 ? MRR / proUsers : 0,
      breakdown: {
        marketplace:    marketplaceRevenue,
        installerFees:  installerFeeRevenue,
        vpp:            vppRevenue,
      },
    },
    orders: {
      count:  ordersData._count.id,
      volume: ordersData._sum.total || 0,
    },
    vpp: {
      payouts: vppPayoutsData._count.id,
      volume:  vppPayoutsData._sum.netAmount || 0,
    },
    installerJobs: {
      count:   installerPayoutsData._count.id,
      volume:  installerPayoutsData._sum.projectValue || 0,
    },
    monthlyRevenue,
  };

  await cacheSet(cacheKey, result, 300); // 5 min cache for analytics
  return ok(result);
}
