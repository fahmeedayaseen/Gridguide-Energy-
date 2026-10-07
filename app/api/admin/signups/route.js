/**
 * GET /api/admin/signups
 * Signup funnel analytics — step completion rates, drop-off points, sources
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const days  = parseInt(searchParams.get("days") || "30");
  const since = new Date(Date.now() - days * 86400000);

  const [
    totalSignups,
    completedSignups,
    withAddress,
    withUtility,
    withDevice,
    bySource,
    byDay,
    byPlan,
    onboardingSteps,
    recentSignups,
  ] = await Promise.all([
    // Total registrations
    prisma.user.count({ where: { role: "CONSUMER", createdAt: { gte: since } } }),

    // Fully onboarded (completed all 4 steps)
    prisma.user.count({ where: { role: "CONSUMER", onboardingCompleted: true, createdAt: { gte: since } } }),

    // Users who entered their home address
    prisma.user.count({ where: { role: "CONSUMER", homeAddress: { not: null }, createdAt: { gte: since } } }),

    // Users who connected a utility
    prisma.user.count({ where: { role: "CONSUMER", utilityConnected: true, createdAt: { gte: since } } }),

    // Users who connected at least one device
    prisma.user.count({
      where: { role: "CONSUMER", devices: { some: {} }, createdAt: { gte: since } },
    }),

    // Signups by source
    prisma.user.groupBy({
      by: ["signupSource"],
      where: { createdAt: { gte: since } },
      _count: { id: true },
    }),

    // Daily signups for chart
    prisma.$queryRaw`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) AS signups,
        SUM(CASE WHEN onboarding_completed = true THEN 1 ELSE 0 END) AS completed
      FROM users
      WHERE created_at >= ${since}
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `,

    // Breakdown by plan
    prisma.user.groupBy({
      by: ["plan"],
      where: { createdAt: { gte: since } },
      _count: { id: true },
    }),

    // Onboarding step distribution (where users stopped)
    prisma.user.groupBy({
      by: ["onboardingStep"],
      where: { createdAt: { gte: since } },
      _count: { id: true },
    }),

    // Recent signups list
    prisma.user.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, name: true, email: true, plan: true,
        signupSource: true, homeState: true, utilityConnected: true,
        onboardingStep: true, onboardingCompleted: true,
        createdAt: true,
        _count: { select: { devices: true } },
      },
    }),
  ]);

  const funnelSteps = [
    { step: "Registered",       count: totalSignups,    pct: 100 },
    { step: "Added Address",    count: withAddress,     pct: totalSignups > 0 ? Math.round(withAddress / totalSignups * 100) : 0 },
    { step: "Connected Utility",count: withUtility,     pct: totalSignups > 0 ? Math.round(withUtility / totalSignups * 100) : 0 },
    { step: "Added Device",     count: withDevice,      pct: totalSignups > 0 ? Math.round(withDevice / totalSignups * 100) : 0 },
    { step: "Fully Onboarded",  count: completedSignups,pct: totalSignups > 0 ? Math.round(completedSignups / totalSignups * 100) : 0 },
  ];

  return ok({
    period: { days, since: since.toISOString() },
    totals: { signups: totalSignups, completed: completedSignups, withAddress, withUtility, withDevice },
    funnel: funnelSteps,
    bySource: Object.fromEntries(bySource.map(s => [s.signupSource || "unknown", s._count.id])),
    byPlan:   Object.fromEntries(byPlan.map(p => [p.plan, p._count.id])),
    onboardingDropoff: onboardingSteps,
    dailyChart: byDay,
    recentSignups,
  });
}
