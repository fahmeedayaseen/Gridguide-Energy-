/**
 * GET   /api/installers/profile   — full installer profile with certifications, zones, stats
 * PATCH /api/installers/profile   — update profile fields
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const updateSchema = z.object({
  companyName:       z.string().min(1).optional(),
  licenseNumber:     z.string().optional(),
  nabcepCertified:   z.boolean().optional(),
  serviceAreas:      z.array(z.string()).optional(),
  specialties:       z.array(z.string()).optional(),
  territories:       z.array(z.string()).optional(),
  notificationPrefs: z.object({
    leads:    z.boolean(),
    jobs:     z.boolean(),
    reviews:  z.boolean(),
    payments: z.boolean(),
  }).strict().optional(),
}).strict();

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({
    where: { userId: auth.user.id },
    include: {
      user:             { select: { name: true, email: true, phone: true, createdAt: true } },
      location:         true,
      certifications:   true,
      serviceZones:     true,
      reviews:          { select: { rating: true, text: true, createdAt: true }, take: 5, orderBy: { createdAt: "desc" } },
      _count:           { select: { leads: true, jobs: true, referrals: true } },
    },
  });

  if (!installer) return err("Installer not found", 404);

  // Compute stats
  const [completedJobs, pendingPayouts, monthlyRevShare] = await Promise.all([
    prisma.job.count({ where: { installerId: installer.id, status: "COMPLETED" } }),
    prisma.installerPayout.aggregate({
      where: { installerId: installer.id, status: "PENDING" },
      _sum: { netAmount: true },
    }),
    prisma.installerRevenueShare.findFirst({
      where: { installerId: installer.id },
      orderBy: { periodStart: "desc" },
      select: { netPayout: true, activeHomeowners: true, periodStart: true },
    }),
  ]);

  return ok({
    installer: {
      ...installer,
      stats: {
        completedJobs,
        pendingPayout:     pendingPayouts._sum.netAmount || 0,
        monthlyRevenueShare: monthlyRevShare?.netPayout || 0,
        activeReferrals:   monthlyRevShare?.activeHomeowners || 0,
        totalLeads:        installer._count.leads,
        totalJobs:         installer._count.jobs,
        totalReferrals:    installer._count.referrals,
      },
    },
  });
}

export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const updated = await prisma.installer.update({
    where: { id: installer.id },
    data,
  });

  return ok({ installer: updated, message: "Profile updated." });
}
