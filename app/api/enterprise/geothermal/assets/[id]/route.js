/**
 * PATCH  /api/enterprise/geothermal/assets/:id — edit (Manager+)
 * DELETE /api/enterprise/geothermal/assets/:id — delete (Manager+)
 *
 * An asset that readings or PPAs point to can't be deleted — that would
 * silently detach history. Set its status to RETIRED instead, or remove the
 * readings/PPAs first.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { logAudit } from "@/lib/audit.js";
import { resolveEnterpriseActor, auditActor } from "@/lib/enterprise-api-keys.js";
import { assetUpdateSchema, toDates } from "@/lib/geothermal-schemas.js";
import { checkOwnedLinks, isUniqueViolation } from "@/lib/geothermal-store.js";

async function findOwned(orgId, id) {
  return prisma.enterpriseEnergyAsset.findFirst({ where: { id, orgId } });
}

export async function PATCH(request, { params }) {
  const ctx = await resolveEnterpriseActor(request, "Manager");
  if (ctx.error) return err(ctx.error, ctx.status);
  const existing = await findOwned(ctx.org.id, params.id);
  if (!existing) return err("Energy asset not found", 404);

  const { data, error } = await parseBody(request, assetUpdateSchema);
  if (error) return err("Validation failed", 400, error);
  const linkError = await checkOwnedLinks(ctx.org.id, { propertyId: data.propertyId });
  if (linkError) return err(linkError, 404);

  try {
    const asset = await prisma.enterpriseEnergyAsset.update({
      where: { id: existing.id },
      data: toDates(data, ["commercialOperationAt"]),
      include: { property: { select: { id: true, name: true } } },
    });
    await logAudit({
      ...auditActor(ctx), action: "ENERGY_ASSET_UPDATED", targetType: "EnterpriseEnergyAsset", targetId: asset.id,
      orgId: ctx.org.id, category: "ASSIGNMENT", metadata: { changed: Object.keys(data) },
    });
    return ok({ asset, message: "Energy asset updated." });
  } catch (e) {
    if (isUniqueViolation(e)) return err("Another asset already uses that external ID.", 409);
    throw e;
  }
}

export async function DELETE(request, { params }) {
  const ctx = await resolveEnterpriseActor(request, "Manager");
  if (ctx.error) return err(ctx.error, ctx.status);
  const existing = await findOwned(ctx.org.id, params.id);
  if (!existing) return err("Energy asset not found", 404);

  const [readingCount, ppaCount] = await Promise.all([
    prisma.enterpriseSustainabilityReading.count({ where: { assetId: existing.id } }),
    prisma.enterpriseGeothermalPpa.count({ where: { assetId: existing.id } }),
  ]);
  if (readingCount || ppaCount) {
    const parts = [readingCount && `${readingCount} reading${readingCount === 1 ? "" : "s"}`, ppaCount && `${ppaCount} PPA${ppaCount === 1 ? "" : "s"}`].filter(Boolean);
    return err(`This asset is linked to ${parts.join(" and ")}. Set its status to RETIRED instead, or remove those first.`, 409);
  }

  await prisma.enterpriseEnergyAsset.delete({ where: { id: existing.id } });
  await logAudit({
    ...auditActor(ctx), action: "ENERGY_ASSET_DELETED", targetType: "EnterpriseEnergyAsset", targetId: existing.id,
    orgId: ctx.org.id, category: "ASSIGNMENT", metadata: { name: existing.name, type: existing.type },
  });
  return ok({ message: "Energy asset deleted." });
}
