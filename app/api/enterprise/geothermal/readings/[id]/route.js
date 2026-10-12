/**
 * PATCH  /api/enterprise/geothermal/readings/:id — correct a reading (Manager+)
 * DELETE /api/enterprise/geothermal/readings/:id — delete a reading (Manager+)
 * Send null for a measurement to mark it "not measured".
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { logAudit } from "@/lib/audit.js";
import { resolveEnterpriseActor, auditActor } from "@/lib/enterprise-api-keys.js";
import { MEASUREMENT_FIELDS } from "@/lib/geothermal-metrics.mjs";
import { readingUpdateSchema, toDates } from "@/lib/geothermal-schemas.js";
import { checkOwnedLinks } from "@/lib/geothermal-store.js";

const include = { property: { select: { id: true, name: true } }, asset: { select: { id: true, name: true } } };

export async function PATCH(request, { params }) {
  const ctx = await resolveEnterpriseActor(request, "Manager");
  if (ctx.error) return err(ctx.error, ctx.status);
  const existing = await prisma.enterpriseSustainabilityReading.findFirst({ where: { id: params.id, orgId: ctx.org.id } });
  if (!existing) return err("Reading not found", 404);

  const { data, error } = await parseBody(request, readingUpdateSchema);
  if (error) return err("Validation failed", 400, error);
  const linkError = await checkOwnedLinks(ctx.org.id, data);
  if (linkError) return err(linkError, 404);

  const merged = { ...existing, ...data };
  if (!MEASUREMENT_FIELDS.some((f) => merged[f] !== null && merged[f] !== undefined)) {
    return err("A reading must keep at least one measurement. Delete it instead.", 400);
  }

  const reading = await prisma.enterpriseSustainabilityReading.update({
    where: { id: existing.id },
    data: toDates(data, ["recordedAt"]),
    include,
  });
  await logAudit({
    ...auditActor(ctx), action: "SUSTAINABILITY_READING_UPDATED", targetType: "EnterpriseSustainabilityReading",
    targetId: reading.id, orgId: ctx.org.id, category: "OTHER",
    metadata: { changed: Object.keys(data), before: Object.fromEntries(Object.keys(data).map((k) => [k, existing[k]])) },
  });
  return ok({ reading, message: "Reading updated." });
}

export async function DELETE(request, { params }) {
  const ctx = await resolveEnterpriseActor(request, "Manager");
  if (ctx.error) return err(ctx.error, ctx.status);
  const existing = await prisma.enterpriseSustainabilityReading.findFirst({ where: { id: params.id, orgId: ctx.org.id } });
  if (!existing) return err("Reading not found", 404);

  await prisma.enterpriseSustainabilityReading.delete({ where: { id: existing.id } });
  await logAudit({
    ...auditActor(ctx), action: "SUSTAINABILITY_READING_DELETED", targetType: "EnterpriseSustainabilityReading",
    targetId: existing.id, orgId: ctx.org.id, category: "OTHER",
    metadata: { propertyId: existing.propertyId, recordedAt: existing.recordedAt, source: existing.source, externalId: existing.externalId },
  });
  return ok({ message: "Reading deleted." });
}
