/**
 * GET /api/enterprise/geothermal/dashboard
 *   ?days=30            (1–3660)  — or —
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, max 3660 days)
 *   &propertyId=        optional filter
 *
 * Readings are aggregated in Postgres (one row per UTC day) instead of being
 * loaded into memory, so long ranges and large sites stay fast.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { resolveEnterpriseActor } from "@/lib/enterprise-api-keys.js";
import { buildDailyAggregateSql, metricsFromDailySqlRows, estimatePpaValue } from "@/lib/geothermal-metrics.mjs";
import { checkOwnedLinks } from "@/lib/geothermal-store.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 3660;

function resolveRange(params) {
  const fromParam = params.get("from");
  const toParam = params.get("to");
  if (fromParam || toParam) {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(fromParam || "") || !re.test(toParam || "")) return { error: "from and to must both be YYYY-MM-DD" };
    const from = new Date(`${fromParam}T00:00:00.000Z`);
    const to = new Date(new Date(`${toParam}T00:00:00.000Z`).getTime() + DAY_MS); // inclusive end date
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return { error: "Invalid date range" };
    if ((to - from) / DAY_MS > MAX_DAYS) return { error: `Date range can't exceed ${MAX_DAYS} days` };
    return { from, to, days: Math.round((to - from) / DAY_MS) };
  }
  const days = Math.min(MAX_DAYS, Math.max(1, Number.parseInt(params.get("days") || "30", 10) || 30));
  const to = new Date();
  return { from: new Date(to.getTime() - days * DAY_MS), to, days };
}

export async function GET(request) {
  const ctx = await resolveEnterpriseActor(request, "Viewer");
  if (ctx.error) return err(ctx.error, ctx.status);

  const params = new URL(request.url).searchParams;
  const range = resolveRange(params);
  if (range.error) return err(range.error, 400);
  const propertyId = params.get("propertyId") || null;
  const linkError = await checkOwnedLinks(ctx.org.id, { propertyId });
  if (linkError) return err(linkError, 404);

  const orgId = ctx.org.id;
  const { sql, params: sqlParams } = buildDailyAggregateSql({ orgId, from: range.from, to: range.to, propertyId });
  const assetWhere = { orgId, ...(propertyId && { propertyId }) };
  const include = { property: { select: { id: true, name: true } } };

  const [dailyRows, assets, ppas, properties] = await Promise.all([
    prisma.$queryRawUnsafe(sql, ...sqlParams),
    prisma.enterpriseEnergyAsset.findMany({ where: assetWhere, include, orderBy: { createdAt: "desc" } }),
    prisma.enterpriseGeothermalPpa.findMany({ where: assetWhere, include: { ...include, asset: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.enterpriseProperty.findMany({ where: { orgId }, select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }),
  ]);

  const { metrics, trend } = metricsFromDailySqlRows(dailyRows);
  const ppasWithValue = ppas.map((ppa) => ({ ...ppa, valueEstimate: estimatePpaValue(ppa) }));
  const knownContractValue = ppasWithValue.reduce((total, ppa) => total + (ppa.valueEstimate?.estimatedContractValue || 0), 0);
  const pricedCount = ppasWithValue.filter((p) => p.valueEstimate).length;

  return ok({
    yourRole: ctx.role,
    period: { days: range.days, from: range.from.toISOString(), to: range.to.toISOString(), propertyId },
    metrics,
    portfolio: {
      propertyCount: properties.length,
      assetCount: assets.length,
      activeAssetCount: assets.filter((asset) => asset.status === "ACTIVE").length,
      contractedMw: ppas.filter((ppa) => ["ACTIVE", "PENDING_APPROVAL"].includes(ppa.status)).reduce((total, ppa) => total + ppa.contractedMw, 0),
      knownEstimatedContractValue: pricedCount ? knownContractValue : null,
      pricedPpaCount: pricedCount,
    },
    properties,
    assets,
    ppas: ppasWithValue,
    trend,
  });
}
