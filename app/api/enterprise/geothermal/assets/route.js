import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

export const assetSchema = z.object({
  propertyId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(150),
  type: z.enum(["GEOTHERMAL_GENERATION", "GROUND_SOURCE_HEAT_PUMP", "THERMAL_STORAGE", "BATTERY", "UPS", "CHILLER", "GRID_CONNECTION", "SOLAR"]),
  status: z.enum(["PLANNED", "CONSTRUCTION", "ACTIVE", "INACTIVE", "RETIRED"]).default("PLANNED"),
  provider: z.string().trim().max(150).nullable().optional(),
  externalId: z.string().trim().max(150).nullable().optional(),
  ratedCapacityKw: z.coerce.number().nonnegative().nullable().optional(),
  thermalCapacityKwh: z.coerce.number().nonnegative().nullable().optional(),
  coolingType: z.enum(["AIR", "WATER", "HYBRID", "CLOSED_LOOP", "GROUND_SOURCE", "OTHER"]).nullable().optional(),
  waterSource: z.enum(["MUNICIPAL", "RECLAIMED", "GROUNDWATER", "SURFACE", "CLOSED_LOOP", "NONE", "OTHER"]).nullable().optional(),
  commercialOperationAt: z.string().datetime().nullable().optional(),
}).strict();

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseRole(auth.user.id, "Viewer");
  if (!access.allowed) return err(access.error, access.status);
  const assets = await prisma.enterpriseEnergyAsset.findMany({
    where: { orgId: access.org.id },
    include: { property: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return ok({ assets, yourRole: access.role });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);
  const { data, error } = await parseBody(request, assetSchema);
  if (error) return err("Validation failed", 400, error);
  if (data.propertyId) {
    const owned = await prisma.enterpriseProperty.count({ where: { id: data.propertyId, orgId: access.org.id } });
    if (!owned) return err("Property not found", 404);
  }
  const asset = await prisma.enterpriseEnergyAsset.create({
    data: { ...data, orgId: access.org.id, commercialOperationAt: data.commercialOperationAt ? new Date(data.commercialOperationAt) : null },
  });
  await logAudit({ actorUserId: auth.user.id, actorRole: access.role, action: "ENERGY_ASSET_ADDED", targetType: "EnterpriseEnergyAsset", targetId: asset.id, orgId: access.org.id, category: "ASSIGNMENT", metadata: { name: asset.name, type: asset.type } });
  return ok({ asset, message: "Energy asset added." }, 201);
}
