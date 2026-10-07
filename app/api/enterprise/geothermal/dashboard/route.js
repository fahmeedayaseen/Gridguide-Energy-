import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";
import { buildDailyTrend, calculateEnergyWaterMetrics, estimatePpaValue } from "@/lib/geothermal-metrics.mjs";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseRole(auth.user.id, "Viewer");
  if (!access.allowed) return err(access.error, access.status);

  const params = new URL(request.url).searchParams;
  const days = Math.min(3660, Math.max(1, Number.parseInt(params.get("days") || "30", 10) || 30));
  const propertyId = params.get("propertyId") || null;
  if (propertyId) {
    const owned = await prisma.enterpriseProperty.count({ where: { id: propertyId, orgId: access.org.id } });
    if (!owned) return err("Property not found", 404);
  }
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const readingWhere = { orgId: access.org.id, recordedAt: { gte: from }, ...(propertyId && { propertyId }) };
  const assetWhere = { orgId: access.org.id, ...(propertyId && { propertyId }) };

  const [readings, assets, ppas, properties] = await Promise.all([
    prisma.enterpriseSustainabilityReading.findMany({ where: readingWhere, orderBy: { recordedAt: "asc" } }),
    prisma.enterpriseEnergyAsset.findMany({ where: assetWhere, include: { property: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.enterpriseGeothermalPpa.findMany({ where: assetWhere, include: { property: { select: { id: true, name: true } }, asset: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.enterpriseProperty.findMany({ where: { orgId: access.org.id }, select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }),
  ]);

  const ppasWithValue = ppas.map((ppa) => ({ ...ppa, valueEstimate: estimatePpaValue(ppa) }));
  const knownContractValue = ppasWithValue.reduce((total, ppa) => total + (ppa.valueEstimate?.estimatedContractValue || 0), 0);

  return ok({
    yourRole: access.role,
    period: { days, from: from.toISOString(), to: new Date().toISOString() },
    metrics: calculateEnergyWaterMetrics(readings),
    portfolio: {
      propertyCount: properties.length,
      assetCount: assets.length,
      activeAssetCount: assets.filter((asset) => asset.status === "ACTIVE").length,
      contractedMw: ppas.filter((ppa) => ["ACTIVE", "PENDING_APPROVAL"].includes(ppa.status)).reduce((total, ppa) => total + ppa.contractedMw, 0),
      knownEstimatedContractValue: knownContractValue,
    },
    properties,
    assets,
    ppas: ppasWithValue,
    trend: buildDailyTrend(readings),
  });
}
