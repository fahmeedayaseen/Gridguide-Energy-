import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const nonnegative = z.coerce.number().nonnegative().default(0);
const readingSchema = z.object({
  propertyId: z.string(),
  assetId: z.string().nullable().optional(),
  recordedAt: z.string().datetime(),
  intervalMinutes: z.coerce.number().int().min(1).max(44640).default(60),
  facilityEnergyKwh: nonnegative,
  itEnergyKwh: nonnegative,
  geothermalDeliveredKwh: nonnegative,
  gridEnergyKwh: nonnegative,
  coolingEnergyKwh: nonnegative,
  waterWithdrawnGallons: nonnegative,
  waterConsumedGallons: nonnegative,
  baselineWaterConsumedGallons: nonnegative,
  waterRecycledGallons: nonnegative,
  carbonAvoidedKg: nonnegative,
  source: z.enum(["MANUAL", "CSV", "API", "METER", "DCIM", "BMS"]).default("MANUAL"),
  externalId: z.string().max(200).nullable().optional(),
}).strict();
const bodySchema = z.union([readingSchema, z.object({ readings: z.array(readingSchema).min(1).max(500) }).strict()]);

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseRole(auth.user.id, "Viewer");
  if (!access.allowed) return err(access.error, access.status);
  const params = new URL(request.url).searchParams;
  const limit = Math.min(1000, Math.max(1, Number.parseInt(params.get("limit") || "250", 10) || 250));
  const readings = await prisma.enterpriseSustainabilityReading.findMany({
    where: { orgId: access.org.id, ...(params.get("propertyId") && { propertyId: params.get("propertyId") }) },
    include: { property: { select: { id: true, name: true } }, asset: { select: { id: true, name: true } } },
    orderBy: { recordedAt: "desc" }, take: limit,
  });
  return ok({ readings, yourRole: access.role });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);
  const { data, error } = await parseBody(request, bodySchema);
  if (error) return err("Validation failed", 400, error);
  const rows = data.readings || [data];
  const propertyIds = [...new Set(rows.map((row) => row.propertyId))];
  const assetIds = [...new Set(rows.map((row) => row.assetId).filter(Boolean))];
  const [properties, assets] = await Promise.all([
    prisma.enterpriseProperty.findMany({ where: { id: { in: propertyIds }, orgId: access.org.id }, select: { id: true } }),
    assetIds.length ? prisma.enterpriseEnergyAsset.findMany({ where: { id: { in: assetIds }, orgId: access.org.id }, select: { id: true } }) : [],
  ]);
  if (properties.length !== propertyIds.length) return err("One or more properties were not found", 404);
  if (assets.length !== assetIds.length) return err("One or more energy assets were not found", 404);

  const normalized = rows.map((row) => ({ ...row, orgId: access.org.id, recordedAt: new Date(row.recordedAt) }));
  let created;
  if (normalized.length === 1) {
    created = [await prisma.enterpriseSustainabilityReading.create({ data: normalized[0] })];
  } else {
    const result = await prisma.enterpriseSustainabilityReading.createMany({ data: normalized, skipDuplicates: true });
    created = { count: result.count };
  }
  await logAudit({ actorUserId: auth.user.id, actorRole: access.role, action: "SUSTAINABILITY_READINGS_IMPORTED", targetType: "EnterpriseSustainabilityReading", orgId: access.org.id, category: "OTHER", metadata: { submitted: normalized.length, created: Array.isArray(created) ? created.length : created.count } });
  return ok({ readings: created, message: `${Array.isArray(created) ? created.length : created.count} reading(s) saved.` }, 201);
}
