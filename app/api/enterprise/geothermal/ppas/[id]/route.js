/**
 * PATCH  /api/enterprise/geothermal/ppas/:id — edit (Manager+)
 * DELETE /api/enterprise/geothermal/ppas/:id — delete (Manager+)
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { logAudit } from "@/lib/audit.js";
import { resolveEnterpriseActor, auditActor } from "@/lib/enterprise-api-keys.js";
import { estimatePpaValue } from "@/lib/geothermal-metrics.mjs";
import { ppaUpdateSchema, toDates } from "@/lib/geothermal-schemas.js";
import { checkOwnedLinks } from "@/lib/geothermal-store.js";

const DATE_FIELDS = ["signedAt", "deliveryStartAt", "deliveryEndAt"];
const include = { property: { select: { id: true, name: true } }, asset: { select: { id: true, name: true } } };

export async function PATCH(request, { params }) {
  const ctx = await resolveEnterpriseActor(request, "Manager");
  if (ctx.error) return err(ctx.error, ctx.status);
  const existing = await prisma.enterpriseGeothermalPpa.findFirst({ where: { id: params.id, orgId: ctx.org.id } });
  if (!existing) return err("PPA not found", 404);

  const { data, error } = await parseBody(request, ppaUpdateSchema);
  if (error) return err("Validation failed", 400, error);
  const linkError = await checkOwnedLinks(ctx.org.id, data);
  if (linkError) return err(linkError, 404);

  // Check the delivery window against the stored value of whichever end wasn't sent.
  const start = data.deliveryStartAt !== undefined ? data.deliveryStartAt : existing.deliveryStartAt;
  const end = data.deliveryEndAt !== undefined ? data.deliveryEndAt : existing.deliveryEndAt;
  if (start && end && new Date(end) < new Date(start)) {
    return err("Delivery end must be on or after delivery start", 400);
  }

  const ppa = await prisma.enterpriseGeothermalPpa.update({ where: { id: existing.id }, data: toDates(data, DATE_FIELDS), include });
  await logAudit({
    ...auditActor(ctx), action: "GEOTHERMAL_PPA_UPDATED", targetType: "EnterpriseGeothermalPpa", targetId: ppa.id,
    orgId: ctx.org.id, category: "OTHER", metadata: { changed: Object.keys(data) },
  });
  return ok({ ppa: { ...ppa, valueEstimate: estimatePpaValue(ppa) }, message: "PPA updated." });
}

export async function DELETE(request, { params }) {
  const ctx = await resolveEnterpriseActor(request, "Manager");
  if (ctx.error) return err(ctx.error, ctx.status);
  const existing = await prisma.enterpriseGeothermalPpa.findFirst({ where: { id: params.id, orgId: ctx.org.id } });
  if (!existing) return err("PPA not found", 404);

  await prisma.enterpriseGeothermalPpa.delete({ where: { id: existing.id } });
  await logAudit({
    ...auditActor(ctx), action: "GEOTHERMAL_PPA_DELETED", targetType: "EnterpriseGeothermalPpa", targetId: existing.id,
    orgId: ctx.org.id, category: "OTHER", metadata: { name: existing.name, seller: existing.seller },
  });
  return ok({ message: "PPA deleted." });
}
