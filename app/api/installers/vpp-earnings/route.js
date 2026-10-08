/**
 * GET /api/installers/vpp-earnings   — VPP earnings from referred homeowners
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { getPlatformConfig } from "@/lib/platform-config.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer account not found.", 404);

  const earnings = await prisma.installerVppEarning.findMany({
    where:   { installerId: installer.id },
    orderBy: { createdAt: "desc" },
    take:    24,
    include: {
      event: {
        select: { windowStart: true, totalKwh: true, participantCount: true, status: true },
      },
    },
  });

  const totals = await prisma.installerVppEarning.aggregate({
    where: { installerId: installer.id },
    _sum:  { installerShare: true, participatingHomes: true },
    _count: { id: true },
  });

  // How many referred homes are VPP-enrolled
  const vppEnrolledReferrals = await prisma.installerReferral.count({
    where: {
      installerId: installer.id,
      user: { vppEnrollment: { active: true } },
    },
  });

  let perEventRate = 5;
  try { const cfg = await getPlatformConfig(); if (typeof cfg.vppProjectedPerEventRate === "number") perEventRate = cfg.vppProjectedPerEventRate; } catch {}

  return ok({
    earnings,
    totals: {
      events:             totals._count.id,
      totalEarned:        totals._sum.installerShare || 0,
      totalParticipating: totals._sum.participatingHomes || 0,
    },
    vppEligibleHomes: vppEnrolledReferrals,
    // A projection, not earnings: enrolled homes × an admin-set per-event
    // assumption (PlatformConfig.vppProjectedPerEventRate). Real amounts are
    // in `totals`, which come from settled events.
    projection: {
      perEvent:        vppEnrolledReferrals * perEventRate,
      ratePerHome:     perEventRate,
      isAssumption:    true,
      note:            "Projection based on an assumed per-home rate. Actual earnings depend on settled events.",
    },
    projectedPerEvent: vppEnrolledReferrals * perEventRate, // kept for existing callers
  });
}
