import React from "react";
import { createRoot } from "react-dom/client";
import { EntGeothermal } from "./platform.jsx";
import { calculateEnergyWaterMetrics, buildDailyTrend, estimatePpaValue } from "./metrics.mjs";
import * as P from "./portfolio.mjs";
import * as M from "./meters.mjs";
window.React = React;

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const monthStart = (offset) => { const d = new Date(); d.setUTCDate(1); d.setUTCHours(0,0,0,0); d.setUTCMonth(d.getUTCMonth() + offset); return d.toISOString(); };
const SWAP_METERS = [
    { id: "mt2a", propertyId: "p2", name: "Old main meter", meterLevel: "MAIN", coveragePct: 100, effectiveFrom: monthStart(-6), effectiveTo: iso(Date.parse(monthStart(-1)) + 9 * 864e5), preferredSettlement: false, parentMeterId: null },
    { id: "mt2b", propertyId: "p2", name: "New main meter", meterLevel: "MAIN", coveragePct: 100, effectiveFrom: iso(Date.parse(monthStart(-1)) + 9 * 864e5), effectiveTo: null, preferredSettlement: false, parentMeterId: null },
];
const SWAP_READINGS = [
    // A monthly total covering the whole of last month: it can't be split at the Day-10 meter swap.
    { id: "r2b", propertyId: "p2", assetId: null, meterId: "mt2b", recordedAt: monthStart(-1), intervalMinutes: (Date.parse(monthStart(0)) - Date.parse(monthStart(-1))) / 60e3, source: "METER", facilityEnergyKwh: 12 * 1000 * (Date.parse(monthStart(0)) - Date.parse(monthStart(-1))) / 3600e3 },
];
const db = {
  properties: [{ id: "p1", name: "Cheyenne DC", type: "DATA_CENTER", requiredReserveMarginPct: 15, gridWaterIntensityGalPerMwh: null, gridWaterIntensitySource: null }],
  assets: [{ id: "a1", propertyId: "p1", name: "Gas turbines (microgrid)", type: "GAS_TURBINE", status: "ACTIVE", ratedCapacityKw: 60000, microgrid: true, firmCapacityKw: 55000 }],
  contracts: [
    { id: "c1", propertyId: "p1", name: "Geothermal PPA", seller: "Dev A", status: "ACTIVE", resourceType: "GEOTHERMAL", contractType: "PPA", contractedMw: 20, capacityFactorPct: 95, firmCapacityMw: 19, termYears: 20, waterIntensityGalPerMwh: 10, waterIntensitySource: "Developer disclosure" },
    { id: "c2", propertyId: "p1", name: "Wind PPA", seller: "Dev B", status: "ACTIVE", resourceType: "WIND", contractType: "VIRTUAL_PPA", contractedMw: 100, capacityFactorPct: 40, termYears: 15 },
  ],
  deliveries: [{ id: "d1", contractId: "c1", periodStart: monthStart(-1), periodEnd: monthStart(0), deliveredMwh: 12000, peakDeliveredMw: 19.5, source: "SETTLEMENT" }],
  "ramp-steps": [
    { id: "s1", propertyId: "p1", effectiveDate: monthStart(-3), phase: "CONSTRUCTION", plannedLoadMw: 5 },
    { id: "s2", propertyId: "p1", effectiveDate: monthStart(4), phase: "PEAK_OPERATION", plannedLoadMw: 180, plannedPeakMw: 220 },
  ],
  milestones: [{ id: "m1", propertyId: "p1", category: "TRANSMISSION", title: "230 kV line approval", agency: "State PSC", status: "FILED", dueDate: iso(now - 5 * 864e5) }],
  "cost-allocations": [{ id: "k1", propertyId: "p1", category: "TRANSMISSION", description: "Line upgrade", totalCost: 1000000, customerShare: 800000, ratepayerShare: 200000, otherShare: 0, basis: "COMMISSION_ORDER", status: "APPROVED", sourceReference: "Docket 123" }],
  meters: [
    { id: "mt1", propertyId: "p1", name: "Utility revenue meter", meterLevel: "SETTLEMENT", coveragePct: 100, effectiveFrom: monthStart(-6), effectiveTo: null, preferredSettlement: true, parentMeterId: null }],
  readings: [
    { id: "r1", propertyId: "p1", assetId: null, meterId: "mt1", recordedAt: iso(now - 2 * 3600e3), intervalMinutes: 60, source: "METER", facilityEnergyKwh: 6000, itEnergyKwh: 5000, gridEnergyKwh: 1000,
      waterWithdrawnGallons: 1000, waterReclaimedImportedGallons: 0, waterConsumedGallons: 700, waterDischargedGallons: null, waterRecycledGallons: 300 },
  ],
};
// ?swap adds a second site whose main meter was replaced on day 10 of last month and which
// only sent a monthly total — the month can't be split, so load must show ESTIMATED.
if (location.search.includes("swap")) {
  db.properties.push({ id: "p2", name: "Reno DC (meter swap)", type: "DATA_CENTER", requiredReserveMarginPct: null, gridWaterIntensityGalPerMwh: null, gridWaterIntensitySource: null });
  db.meters.push(...SWAP_METERS);
  db.readings.push(...SWAP_READINGS);
}
let seq = 100;
window.__calls = [];
const json = (b, status = 200) => Promise.resolve(new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } }));
const rel = (x) => ({ ...x, property: db.properties.find((p) => p.id === x.propertyId) || null, asset: db.assets.find((a) => a.id === x.assetId) || null, contract: db.contracts.find((c) => c.id === x.contractId) || null });
function portfolio(pid) {
  const from = new Date(now - 30 * 864e5), to = new Date(now);
  const contracts = db.contracts.filter((c) => !pid || c.propertyId === pid);
  const perf = P.deliveryPerformance(contracts, db.deliveries, { from: new Date(0), to });
  const readings = db.readings.filter((r) => !pid || r.propertyId === pid);
  const metrics = calculateEnergyWaterMetrics(readings);
  const sites = db.properties.filter((p) => !pid || p.id === pid).map((p) => {
    const steps = db["ramp-steps"].filter((s) => s.propertyId === p.id).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    // One row per reading with its start/end, like the portfolio SQL's per-interval groups.
    const mm = readings.filter((r) => r.propertyId === p.id && r.facilityEnergyKwh != null && (r.meterId || !r.assetId)).map((r) => ({ month: r.recordedAt.slice(0, 7), meterId: r.meterId || null, kwh: r.facilityEnergyKwh, minutes: r.intervalMinutes, count: 1, firstAt: r.recordedAt, lastEndAt: iso(Date.parse(r.recordedAt) + r.intervalMinutes * 60e3) }));
    const siteMeters = db.meters.filter((m) => m.propertyId === p.id);
    const monthly = Object.entries(M.siteMonthlyLoad(siteMeters, Object.values(mm))).map(([month, v]) => ({ month, ...v }));
    const first = steps[0] ? new Date(steps[0].effectiveDate) : from; const last = steps.length ? new Date(steps.at(-1).effectiveDate) : to;
    return { property: p, hasPlan: !!steps.length, steps, meters: siteMeters,
      reserve: P.reserveMargin({ property: p, contracts: contracts.filter((c) => c.propertyId === p.id), assets: db.assets.filter((a) => a.propertyId === p.id), steps }),
      ramp: P.rampComparison(steps, Object.values(monthly), { from: new Date(Math.min(first, from)), to: new Date(Math.max(+to, +last + 31 * 864e5)) }) };
  });
  const gridKwh = {}; for (const r of readings) if (r.gridEnergyKwh != null) gridKwh[r.propertyId] = (gridKwh[r.propertyId] || 0) + r.gridEnergyKwh;
  const upstream = P.upstreamWater({ contracts, performance: perf, properties: db.properties, gridKwhByProperty: gridKwh });
  return { ok: true, supply: { mix: P.resourceMix(contracts, db.assets, perf), delivery: perf }, sites,
    regulatory: P.milestoneSummary(db.milestones), costs: P.costAllocationSummary(db["cost-allocations"]),
    calculation: { calculatedAt: new Date().toISOString(), formulaVersions: { water: "water-balance-v2", delivery: "delivery-vs-contract-v1", resourceMix: "resource-mix-v1" } },
    water: { siteClaims: [], evidenceStatus: metrics.waterEvidenceStatus, direct: { withdrawnGallons: metrics.totals.waterWithdrawnGallons, reclaimedImportedGallons: metrics.totals.waterReclaimedImportedGallons, storageChangeGallons: metrics.totals.waterStorageChangeGallons, nonPotableSharePct: metrics.efficiency.nonPotableSharePct, consumedGallons: metrics.totals.waterConsumedGallons, dischargedGallons: metrics.totals.waterDischargedGallons, recycledGallons: metrics.totals.waterRecycledGallons, savedVsBaselineGallons: metrics.totals.waterSavedGallons, wueLitersPerItKwh: metrics.efficiency.wueLitersPerItKwh, recycledWaterSharePct: metrics.efficiency.recycledWaterSharePct },
      claim: metrics.waterClaim, upstream, totalConsumptiveGallons: metrics.totals.waterConsumedGallons != null && upstream.upstreamGallons != null ? metrics.totals.waterConsumedGallons + upstream.upstreamGallons : null } };
}
window.fetch = async (url, opts = {}) => {
  const u = new URL(url, location.origin); const m = (opts.method || "GET").toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : null;
  window.__calls.push({ m, path: u.pathname + u.search, body });
  const [, coll, id] = u.pathname.replace("/api/enterprise/energy-water", "").split("/");
  const pid = u.searchParams.get("propertyId");
  if (coll === "dashboard") {
    const rs = db.readings.filter((r) => !pid || r.propertyId === pid);
    const ppas = db.contracts.map((c) => ({ ...rel(c), valueEstimate: estimatePpaValue(c) }));
    return json({ ok: true, yourRole: "Admin", metrics: calculateEnergyWaterMetrics(rs), trend: buildDailyTrend(rs),
      portfolio: { assetCount: db.assets.length, activeAssetCount: 1, contractedMw: 120, knownEstimatedContractValue: null, pricedPpaCount: 0 },
      properties: db.properties, assets: db.assets.map(rel), ppas });
  }
  if (coll === "portfolio") return json(portfolio(pid));
  if (coll === "properties" && m === "PATCH") { Object.assign(db.properties.find((p) => p.id === id), body); return json({ ok: true, message: "Site settings updated." }); }
  if (coll === "meters" && m === "POST") {
    const problems = M.validateMeter({ id: "__new__", ...body, coveragePct: Number(body.coveragePct) }, db.meters.filter((x) => x.propertyId === body.propertyId));
    if (problems.length) return json({ ok: false, error: problems.join(" ") }, 409);
  }
  const store = db[coll];
  if (!store) return json({ ok: false, error: "not mocked " + coll }, 404);
  const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === "") o[k] = null; return o; };
  if (m === "GET") { const items = store.filter((x) => !pid || x.propertyId === pid).map(rel); return json({ ok: true, items, readings: items, deliveries: items, nextCursor: null }); }
  if (m === "POST") { const rows = body.readings || body.deliveries || [body]; for (const r of rows) store.push(clean({ id: `x${seq++}`, ...r })); return json({ ok: true, created: rows.length, updated: 0, message: "Saved." }, 201); }
  if (m === "PATCH") { Object.assign(store.find((x) => x.id === id), clean({ ...body })); return json({ ok: true, message: "Updated." }); }
  if (m === "DELETE") { db[coll] = store.filter((x) => x.id !== id); return json({ ok: true, message: "Deleted." }); }
};
window.__db = db; window.confirm = () => true;
createRoot(document.getElementById("root")).render(<EntGeothermal setTab={(t) => (window.__tab = t)} />);
