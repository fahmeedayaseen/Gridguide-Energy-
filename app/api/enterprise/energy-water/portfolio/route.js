/**
 * GET /api/enterprise/energy-water/portfolio
 *   ?days=30 | ?from=YYYY-MM-DD&to=YYYY-MM-DD   &propertyId=   — Viewer+
 *
 * Vendor-neutral accountability summary for data-center energy & water:
 *   - resource mix across every contract and microgrid resource
 *   - actual delivery vs contracted MW / MWh
 *   - reserve margin per site (firm capacity vs ramp-scheduled peak load)
 *   - planned vs actual load ramp per site (construction → peak operation)
 *   - permits / regulatory milestones (overdue, upcoming, expiring)
 *   - customer vs ratepayer cost allocation
 *   - direct cooling water (with water-claim verification) + upstream generation water
 *
 * Nothing is estimated from data that wasn't entered; missing inputs come back as null.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { resolveEnterpriseActor } from "@/lib/enterprise-api-keys.js";
import { checkOwnedLinks } from "@/lib/geothermal-store.js";
import { buildDailyAggregateSql, metricsFromDailySqlRows, WATER_FORMULA_VERSION } from "@/lib/geothermal-metrics.mjs";
import { siteMonthlyLoad, LOAD_FORMULA_VERSION } from "@/lib/energy-water-meters.mjs";
import {
  deliveryPerformance, resourceMix, reserveMargin, rampComparison, costAllocationSummary,
  upstreamWater, milestoneSummary,
} from "@/lib/energy-water-portfolio.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 3660;
const MAX_RAMP_MONTHS = 240;

function resolveRange(params) {
  const f = params.get("from"), t = params.get("to");
  if (f || t) {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(f || "") || !re.test(t || "")) return { error: "from and to must both be YYYY-MM-DD" };
    const from = new Date(`${f}T00:00:00.000Z`);
    const to = new Date(new Date(`${t}T00:00:00.000Z`).getTime() + DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return { error: "Invalid date range" };
    if ((to - from) / DAY_MS > MAX_DAYS) return { error: `Date range can't exceed ${MAX_DAYS} days` };
    return { from, to };
  }
  const days = Math.min(MAX_DAYS, Math.max(1, Number.parseInt(params.get("days") || "30", 10) || 30));
  const to = new Date();
  return { from: new Date(to.getTime() - days * DAY_MS), to };
}

const iso = (d) => d.toISOString();

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
  const byProperty = propertyId ? { propertyId } : {};
  const readingRange = { orgId, recordedAt: { gte: range.from, lt: range.to }, ...byProperty };

  // Monthly facility energy per (site, meter). Duplicate readings for the same
  // meter and timestamp are collapsed deterministically (latest update wins),
  // and meter selection/overlap rules are applied in siteMonthlyLoad().
  // Readings with no meter count only when they're site-level (no asset).
  const loadSqlParams = [orgId, iso(range.from), iso(range.to)];
  let loadWhere = `"orgId" = $1
      AND "recordedAt" >= ($2::timestamptz AT TIME ZONE 'UTC') AND "recordedAt" < ($3::timestamptz AT TIME ZONE 'UTC')
      AND "facilityEnergyKwh" IS NOT NULL AND ("meterId" IS NOT NULL OR "assetId" IS NULL)`;
  if (propertyId) { loadSqlParams.push(propertyId); loadWhere += ` AND "propertyId" = $4`; }
  const loadSql = `SELECT "propertyId", "meterId", to_char("recordedAt", 'YYYY-MM') AS "month",
      SUM("facilityEnergyKwh")::float8 AS "kwh", SUM("intervalMinutes")::float8 AS "minutes", COUNT(*)::int AS "count"
    FROM (
      SELECT DISTINCT ON ("propertyId", COALESCE("meterId", ''), "recordedAt")
        "propertyId", "meterId", "recordedAt", "facilityEnergyKwh", "intervalMinutes"
      FROM "EnterpriseSustainabilityReading"
      WHERE ${loadWhere}
      ORDER BY "propertyId", COALESCE("meterId", ''), "recordedAt", "updatedAt" DESC, "id" DESC
    ) d
    GROUP BY 1, 2, 3 ORDER BY 1, 3, 2`;

  const water = buildDailyAggregateSql({ orgId, from: range.from, to: range.to, propertyId });

  const [properties, contracts, assets, steps, milestones, costs, dailyRows, loadRows, gridByProperty, meters] = await Promise.all([
    prisma.enterpriseProperty.findMany({
      where: { orgId, ...(propertyId && { id: propertyId }) },
      select: { id: true, name: true, type: true, requiredReserveMarginPct: true, gridWaterIntensityGalPerMwh: true, gridWaterIntensitySource: true },
      orderBy: { name: "asc" },
    }),
    prisma.enterpriseGeothermalPpa.findMany({ where: { orgId, ...byProperty }, orderBy: { createdAt: "desc" } }),
    prisma.enterpriseEnergyAsset.findMany({ where: { orgId, ...byProperty } }),
    prisma.enterpriseLoadRampStep.findMany({ where: { orgId, ...byProperty }, orderBy: { effectiveDate: "asc" } }),
    prisma.enterpriseRegulatoryMilestone.findMany({ where: { orgId, ...byProperty } }),
    prisma.enterpriseCostAllocation.findMany({ where: { orgId, ...byProperty } }),
    prisma.$queryRawUnsafe(water.sql, ...water.params),
    prisma.$queryRawUnsafe(loadSql, ...loadSqlParams),
    prisma.enterpriseSustainabilityReading.groupBy({ by: ["propertyId"], where: readingRange, _sum: { gridEnergyKwh: true } }),
    prisma.enterpriseMeter.findMany({ where: { orgId, ...byProperty } }),
  ]);

  const deliveries = contracts.length
    ? await prisma.enterpriseContractDelivery.findMany({
        where: { orgId, contractId: { in: contracts.map((c) => c.id) }, periodEnd: { gt: range.from }, periodStart: { lt: range.to } },
      })
    : [];

  // ── Supply ──
  const performance = deliveryPerformance(contracts, deliveries, range);
  const mix = resourceMix(contracts, assets, performance);

  // ── Per site: reserve margin + load ramp ──
  const sites = properties.map((p) => {
    const siteSteps = steps.filter((s) => s.propertyId === p.id);
    const siteContracts = contracts.filter((c) => c.propertyId === p.id);
    const siteAssets = assets.filter((a) => a.propertyId === p.id);
    // Ramp months span the whole schedule (construction → peak) as well as the selected range.
    const first = siteSteps[0] ? new Date(siteSteps[0].effectiveDate) : range.from;
    const last = siteSteps.length ? new Date(siteSteps[siteSteps.length - 1].effectiveDate) : range.to;
    const rampFrom = new Date(Math.min(first.getTime(), range.from.getTime()));
    let rampTo = new Date(Math.max(range.to.getTime(), last.getTime() + 31 * DAY_MS));
    const maxTo = new Date(rampFrom); maxTo.setUTCMonth(maxTo.getUTCMonth() + MAX_RAMP_MONTHS);
    if (rampTo > maxTo) rampTo = maxTo;
    const siteMeters = meters.filter((m) => m.propertyId === p.id);
    const meterMonths = loadRows.filter((r) => r.propertyId === p.id)
      .map((r) => ({ month: r.month, meterId: r.meterId ?? null, kwh: Number(r.kwh), minutes: Number(r.minutes), count: Number(r.count) }));
    const monthly = Object.entries(siteMonthlyLoad(siteMeters, meterMonths)).map(([month, v]) => ({ month, ...v }));
    return {
      property: p,
      hasPlan: siteSteps.length > 0,
      reserve: reserveMargin({ property: p, contracts: siteContracts, assets: siteAssets, steps: siteSteps }),
      ramp: siteSteps.length || monthly.length ? rampComparison(siteSteps, monthly, { from: rampFrom, to: rampTo }) : [],
      steps: siteSteps,
      meters: siteMeters,
      unassignedReadingsIgnored: monthly.reduce((s, m) => s + (m.unassignedIgnored || 0), 0),
    };
  });

  // ── Water ──
  const propertyLabels = Object.fromEntries(properties.map((p) => [p.id, p.name]));
  const { metrics, siteWaterClaims } = metricsFromDailySqlRows(dailyRows, { propertyLabels });
  const gridKwhByProperty = Object.fromEntries(gridByProperty.map((g) => [g.propertyId, g._sum.gridEnergyKwh]));
  const upstream = upstreamWater({ contracts, performance, properties, gridKwhByProperty });
  const direct = metrics.totals.waterConsumedGallons;

  return ok({
    yourRole: ctx.role,
    period: { from: iso(range.from), to: iso(range.to), propertyId },
    // Provenance for every derived figure in this response.
    calculation: {
      calculatedAt: new Date().toISOString(),
      formulaVersions: {
        water: WATER_FORMULA_VERSION,
        load: LOAD_FORMULA_VERSION,
        reserveMargin: "reserve-margin-v1",
        delivery: "delivery-vs-contract-v1",
        resourceMix: "resource-mix-v1",
        upstreamWater: "upstream-water-v1",
        costAllocation: "cost-allocation-v1",
        milestones: "milestones-v1",
      },
      inputs: {
        contracts: contracts.length, deliveries: deliveries.length, assets: assets.length, meters: meters.length,
        rampSteps: steps.length, milestones: milestones.length, costItems: costs.length,
        readingDays: dailyRows.length,
      },
    },
    supply: { mix, delivery: performance, contractCount: contracts.length },
    sites,
    regulatory: milestoneSummary(milestones),
    costs: costAllocationSummary(costs),
    water: {
      direct: {
        withdrawnGallons: metrics.totals.waterWithdrawnGallons,
        reclaimedImportedGallons: metrics.totals.waterReclaimedImportedGallons,
        storageChangeGallons: metrics.totals.waterStorageChangeGallons,
        nonPotableSharePct: metrics.efficiency.nonPotableSharePct,
        consumedGallons: direct,
        dischargedGallons: metrics.totals.waterDischargedGallons,
        recycledGallons: metrics.totals.waterRecycledGallons,
        savedVsBaselineGallons: metrics.totals.waterSavedGallons,
        wueLitersPerItKwh: metrics.efficiency.wueLitersPerItKwh,
        recycledWaterSharePct: metrics.efficiency.recycledWaterSharePct,
      },
      claim: metrics.waterClaim, // least-trusted across sites
      evidenceStatus: metrics.waterEvidenceStatus, // WUE / recycled share / water saved inherit this
      siteClaims: siteWaterClaims,
      upstream,
      // Total footprint only when both halves are known.
      totalConsumptiveGallons: direct !== null && upstream.upstreamGallons !== null ? Math.round((direct + upstream.upstreamGallons) * 100) / 100 : null,
    },
  });
}
