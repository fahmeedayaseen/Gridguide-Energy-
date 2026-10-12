/**
 * GET /api/enterprise/energy-water/properties
 * The org's sites with their Energy & Water planning settings.
 * Viewer+ or an Enterprise API key.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { resolveEnterpriseActor } from "@/lib/enterprise-api-keys.js";

export async function GET(request) {
  const ctx = await resolveEnterpriseActor(request, "Viewer", { allowApiKey: true });
  if (ctx.error) return err(ctx.error, ctx.status);
  const properties = await prisma.enterpriseProperty.findMany({
    where: { orgId: ctx.org.id },
    select: {
      id: true, name: true, type: true,
      requiredReserveMarginPct: true, gridWaterIntensityGalPerMwh: true, gridWaterIntensitySource: true,
    },
    orderBy: { name: "asc" },
  });
  return ok({ properties });
}
