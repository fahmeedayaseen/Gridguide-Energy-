/**
 * GET  /api/enterprise/geothermal/assets — Viewer+ or Enterprise API key
 * POST /api/enterprise/geothermal/assets — Manager+
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { logAudit } from "@/lib/audit.js";
import { resolveEnterpriseActor, auditActor } from "@/lib/enterprise-api-keys.js";
import { assetCreateSchema, toDates } from "@/lib/geothermal-schemas.js";
import { checkOwnedLinks, isUniqueViolation } from "@/lib/geothermal-store.js";

export async function GET(request) {
  const ctx = await resolveEnterpriseActor(request, "Viewer", { allowApiKey: true });
  if (ctx.error) return err(ctx.error, ctx.status);
  const assets = await prisma.enterpriseEnergyAsset.findMany({
    where: { orgId: ctx.org.id },
    include: { property: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return ok({ assets, yourRole: ctx.role });
}

export async function POST(request) {
  const ctx = await resolveEnterpriseActor(request, "Manager");
  if (ctx.error) return err(ctx.error, ctx.status);
  const { data, error } = await parseBody(request, assetCreateSchema);
  if (error) return err("Validation failed", 400, error);

  const linkError = await checkOwnedLinks(ctx.org.id, { propertyId: data.propertyId });
  if (linkError) return err(linkError, 404);

  try {
    const asset = await prisma.enterpriseEnergyAsset.create({
      data: { ...toDates(data, ["commercialOperationAt"]), orgId: ctx.org.id },
      include: { property: { select: { id: true, name: true } } },
    });
    await logAudit({
      ...auditActor(ctx), action: "ENERGY_ASSET_ADDED", targetType: "EnterpriseEnergyAsset", targetId: asset.id,
      orgId: ctx.org.id, category: "ASSIGNMENT", metadata: { name: asset.name, type: asset.type },
    });
    return ok({ asset, message: "Energy asset added." }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return err("Another asset already uses that external ID.", 409);
    throw e;
  }
}
