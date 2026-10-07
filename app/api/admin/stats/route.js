import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { cacheGet, cacheSet } from "@/lib/redis.js";

// GET /api/admin/stats — live counters for admin dashboard header
export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const cacheKey = "admin:stats:live";
  const cached   = await cacheGet(cacheKey);
  if (cached) return ok({ ...cached, source: "cache" });

  const now     = new Date();
  const today   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalUsers, newUsersToday, newUsersMonth,
    pendingSellers, pendingInstallers, pendingProducts,
    activeVppEvents, totalVppPayout,
    ordersToday, revenueToday,
    installerJobs, activeThermostats,
    vppEnrolled, pendingSurveys, pendingChangeRequests,
    publishedBlogPosts, communityPosts, savedCards,
    totalDevices, onlineDevices, vppEligibleDevices,
    onboardedUsers, usersWithDevice, usersWithUtility,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.user.count({ where: { createdAt: { gte: thisMonth } } }),

    prisma.seller.count({ where: { verificationStatus: "PENDING" } }),
    prisma.installer.count({ where: { verificationStatus: "PENDING" } }),
    prisma.product.count({ where: { status: "PENDING_REVIEW" } }),

    prisma.vppEvent.count({ where: { status: "ACTIVE" } }),
    prisma.vppPayout.aggregate({
      where: { status: "PAID", createdAt: { gte: thisMonth } },
      _sum:  { netAmount: true },
    }),

    prisma.order.count({ where: { status: "PAID", createdAt: { gte: today } } }),
    prisma.order.aggregate({
      where: { status: "PAID", createdAt: { gte: today } },
      _sum:  { commission: true },
    }),

    prisma.job.count({ where: { status: { in: ["SCHEDULED","IN_PROGRESS"] } } }),
    prisma.thermostat.count({ where: { aiOptimize: true } }),
    prisma.vppEnrollment.count({ where: { active: true } }),
    prisma.siteSurvey.count({ where: { status: "SCHEDULED" } }),
    prisma.quoteChangeRequest.count({ where: { status: "PENDING" } }),
    prisma.blogPost.count({ where: { published: true } }),
    prisma.communityPost.count({ where: { published: true } }),
    prisma.paymentCard.count({ where: { isActive: true } }),

    // Device stats
    prisma.device.count(),
    prisma.device.count({ where: { isOnline: true } }),
    prisma.device.count({ where: { vppEligible: true } }),

    // Onboarding completion
    prisma.user.count({ where: { onboardingCompleted: true } }),
    prisma.user.count({ where: { devices: { some: {} } } }),
    prisma.user.count({ where: { utilityConnected: true } }),
  ]);

  const stats = {
    users: { total: totalUsers, today: newUsersToday, month: newUsersMonth },
    pending: {
      sellers:    pendingSellers,
      installers: pendingInstallers,
      products:   pendingProducts,
      total:      pendingSellers + pendingInstallers + pendingProducts,
    },
    vpp: {
      activeEvents: activeVppEvents,
      payoutsThisMonth: vppPayout._sum.netAmount || 0,
    },
    revenue: {
      today:       revenueToday._sum.commission || 0,
      ordersToday: ordersToday,
    },
    platform: {
      activeJobs:       installerJobs,
      aiThermostats:    activeThermostats,
      vppEnrolled,
      pendingSurveys,
      pendingChangeRequests,
    },
    devices: {
      total:      totalDevices,
      online:     onlineDevices,
      offline:    totalDevices - onlineDevices,
      vppEligible: vppEligibleDevices,
    },
    onboarding: {
      fullyOnboarded:   onboardedUsers,
      withDevice:       usersWithDevice,
      withUtility:      usersWithUtility,
      completionRate:   totalUsers > 0 ? Math.round(onboardedUsers / totalUsers * 100) : 0,
    },
    content: {
      publishedBlogPosts,
      communityPosts,
    },
    payments: {
      savedCards,
    },
    ts: now.toISOString(),
  };

  await cacheSet(cacheKey, stats, 60); // 60s cache for live stats
  return ok({ ...stats, source: "live" });
}
