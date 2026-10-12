/**
 * PATCH /api/enterprise/energy-water/properties/:id — Manager+
 * Updates only the Energy & Water planning settings of a site:
 * requiredReserveMarginPct, gridWaterIntensityGalPerMwh, gridWaterIntensitySource.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { logAudit } from "@/lib/audit.js";
import { resolveEnterpriseActor, auditActor } from "@/lib/enterprise-api-keys.js";
import { propertySettingsSchema } from "@/lib/energy-water-schemas.js";

export async function PATCH(request, { params }) {
  const ctx = await resolveEnterpriseActor(request, "Manager");
  if (ctx.error) return err(ctx.error, ctx.status);
  const existing = await prisma.enterpriseProperty.findFirst({ where: { id: params.id, orgId: ctx.org.id } });
  if (!existing) return err("Property not found", 404);
  const { data, error } = await parseBody(request, propertySettingsSchema);
  if (error) return err("Validation failed", 400, error);

  const property = await prisma.enterpriseProperty.update({
    where: { id: existing.id },
    data,
    select: { id: true, name: true, type: true, requiredReserveMarginPct: true, gridWaterIntensityGalPerMwh: true, gridWaterIntensitySource: true },
  });
  await logAudit({
    ...auditActor(ctx), action: "SITE_ENERGY_SETTINGS_UPDATED", targetType: "EnterpriseProperty", targetId: property.id,
    orgId: ctx.org.id, category: "OTHER",
    metadata: { changed: Object.keys(data), before: Object.fromEntries(Object.keys(data).map((k) => [k, existing[k]])) },
  });
  return ok({ property, message: "Site settings updated." });
}
