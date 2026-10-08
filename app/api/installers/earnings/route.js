import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

// GET /api/installers/earnings — installer earnings breakdown
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({
    where: { userId: auth.user.id },
  });
  if (!installer) return err("Installer account not found.", 404);

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "month";
  const since  = {
    week:    new Date(Date.now() - 7  * 86400000),
    month:   new Date(Date.now() - 30 * 86400000),
    quarter: new Date(Date.now() - 90 * 86400000),
    year:    new Date(Date.now() - 365 * 86400000),
    all:     new Date(0),
  }[period] || new Date(Date.now() - 30 * 86400000);

  const [payouts, jobs, pending] = await Promise.all([
    // Paid payouts
    prisma.installerPayout.findMany({
      where:   { installerId: installer.id, status: "PAID", settledAt: { gte: since } },
      orderBy: { settledAt: "desc" },
      include: { job: { select: { title: true, completedAt: true, address: true } } },
    }),
    // All jobs in period
    prisma.job.findMany({
      where:   { installerId: installer.id, createdAt: { gte: since } },
      select:  { id: true, status: true, projectValue: true, successFee: true, completedAt: true, title: true },
    }),
    // Pending payouts
    prisma.installerPayout.aggregate({
      where: { installerId: installer.id, status: "PENDING" },
      _sum:  { netAmount: true },
    }),
  ]);

  const totalEarned   = payouts.reduce((s, p) => s + p.netAmount, 0);
  const totalRevenue  = jobs.filter(j => j.status === "COMPLETED").reduce((s, j) => s + j.projectValue, 0);
  const totalFees     = jobs.filter(j => j.status === "COMPLETED").reduce((s, j) => s + j.successFee, 0);
  const completedCount = jobs.filter(j => j.status === "COMPLETED").length;
  const avgProjectVal = completedCount ? totalRevenue / completedCount : 0; // revenue is completed-only, so divide by completed jobs

  return ok({
    period,
    summary: {
      totalEarned:    Math.round(totalEarned * 100) / 100,
      pendingPayout:  pending._sum.netAmount || 0,
      totalRevenue:   Math.round(totalRevenue * 100) / 100,
      totalFees:      Math.round(totalFees * 100) / 100,
      jobsCompleted:  jobs.filter(j => j.status === "COMPLETED").length,
      jobsTotal:      jobs.length,
      avgProjectVal:  Math.round(avgProjectVal * 100) / 100,
      conversionRate: installer.jobsCompleted > 0
        ? (installer.jobsCompleted / (installer.jobsCompleted + jobs.filter(j => j.status === "CANCELLED").length) * 100).toFixed(1)
        : "0",
    },
    payouts,
    recentJobs: jobs.slice(0, 10),
  });
}
