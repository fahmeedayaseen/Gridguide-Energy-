/**
 * GET /api/public/vpp/providers — providers and programs homeowners can see.
 * Unauthenticated. Only visible providers/ACTIVE programs, and only
 * admin-verified earnings estimates; unverified admin-typed rate fields
 * (estimatedRateKwh / estimatedRateKw) are never exposed.
 */
import { prisma } from "@/lib/db.js";
import { ok } from "@/lib/auth.js";
import { isProviderPubliclyVisible, canProviderAcceptEnrollment } from "@/lib/vpp/provider-controls.js";
import { getPublicVppEarningsDisplay } from "@/lib/vpp/earnings-estimates.js";

export async function GET() {
  const providers = await prisma.vppProvider.findMany({
    orderBy: { name: "asc" },
    include: {
      programs: {
        where: { status: "ACTIVE" },
        select: {
          id: true, name: true, market: true, state: true, utility: true, programType: true, deviceTypes: true,
          earningsEstimates: true,
        },
      },
    },
  });

  const visible = providers.filter(isProviderPubliclyVisible).map((p) => ({
    id: p.id, key: p.key, name: p.name,
    enrollmentOpen: canProviderAcceptEnrollment(p),
    programs: p.programs.map(({ earningsEstimates, ...prog }) => ({
      ...prog,
      earnings: getPublicVppEarningsDisplay(earningsEstimates),
    })),
  }));

  return ok({
    providers: visible,
    disclaimer: "VPP incentives are not guaranteed. Amounts vary by utility program, device, location, and how many events are called.",
  });
}
