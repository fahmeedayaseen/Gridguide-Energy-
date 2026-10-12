import React from "react";
import { createRoot } from "react-dom/client";
import { EntGeothermal } from "./platform.jsx";
import { calculateEnergyWaterMetrics, buildDailyTrend, estimatePpaValue } from "./metrics.mjs";
window.React = React;

// ── In-memory mock of the geothermal API ──
const db = {
  properties: [{ id: "p1", name: "Reno DC", type: "DATA_CENTER" }, { id: "p2", name: "Austin DC", type: "DATA_CENTER" }],
  assets: [{ id: "a1", name: "Steamboat Unit 1", type: "GEOTHERMAL_GENERATION", status: "ACTIVE", propertyId: "p1", ratedCapacityKw: 5000, provider: "Ormat" }],
  ppas: [], readings: [],
};
let seq = 100;
const now = Date.now();
db.readings.push({ id: "r0", propertyId: "p1", assetId: "a1", recordedAt: new Date(now - 3600e3).toISOString(), intervalMinutes: 60, source: "MANUAL", facilityEnergyKwh: 1200, itEnergyKwh: 1000, geothermalDeliveredKwh: 900, gridEnergyKwh: 300, coolingEnergyKwh: null, waterWithdrawnGallons: null, waterConsumedGallons: null, baselineWaterConsumedGallons: null, waterRecycledGallons: null, carbonAvoidedKg: null });
window.__calls = [];
const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const withProp = (x) => ({ ...x, property: db.properties.find((p) => p.id === x.propertyId) || null, asset: db.assets.find((a) => a.id === x.assetId) || null });
window.fetch = async (url, opts = {}) => {
  const u = new URL(url, location.origin); const m = (opts.method || "GET").toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : null;
  window.__calls.push({ m, path: u.pathname + u.search, body });
  const path = u.pathname.replace(/\/api\/enterprise\/(geothermal|energy-water)/, "").replace(/^\/contracts/, "/ppas");
  const pid = u.searchParams.get("propertyId");
  if (path === "/dashboard") {
    const rs = db.readings.filter((r) => !pid || r.propertyId === pid);
    const ppas = db.ppas.filter((p) => !pid || p.propertyId === pid).map((p) => ({ ...withProp(p), valueEstimate: estimatePpaValue(p) }));
    const priced = ppas.filter((p) => p.valueEstimate);
    return json({ ok: true, yourRole: "Admin", metrics: calculateEnergyWaterMetrics(rs), trend: buildDailyTrend(rs),
      portfolio: { assetCount: db.assets.length, activeAssetCount: db.assets.filter((a) => a.status === "ACTIVE").length, contractedMw: ppas.reduce((t, p) => t + Number(p.contractedMw), 0), knownEstimatedContractValue: priced.length ? priced.reduce((t, p) => t + p.valueEstimate.estimatedContractValue, 0) : null, pricedPpaCount: priced.length },
      properties: db.properties, assets: db.assets.filter((a) => !pid || a.propertyId === pid).map(withProp), ppas });
  }
  const coll = path.startsWith("/assets") ? "assets" : path.startsWith("/ppas") ? "ppas" : path.startsWith("/readings") ? "readings" : null;
  const id = path.split("/")[2];
  if (coll === "readings" && m === "GET") return json({ ok: true, readings: db.readings.filter((r) => !pid || r.propertyId === pid).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map(withProp), nextCursor: null });
  if (coll && m === "POST") {
    if (coll === "readings") {
      const rows = body.readings || [body];
      for (const r of rows) {
        for (const k of Object.keys(r)) if (r[k] === "") r[k] = null;
        if (r.externalId) { const ex = db.readings.find((x) => x.source === r.source && x.externalId === r.externalId); if (ex) { Object.assign(ex, r); continue; } }
        db.readings.push({ id: `r${seq++}`, intervalMinutes: 60, source: "MANUAL", ...r });
      }
      return json({ ok: true, created: rows.length, updated: 0, message: `${rows.length} saved.` }, 201);
    }
    const rec = { id: `${coll[0]}${seq++}`, ...body }; for (const k of Object.keys(rec)) if (rec[k] === "") rec[k] = null;
    db[coll].push(rec); return json({ ok: true, message: "Added." }, 201);
  }
  if (coll && m === "PATCH") { const rec = db[coll].find((x) => x.id === id); for (const k of Object.keys(body)) rec[k] = body[k] === "" ? null : body[k]; return json({ ok: true, message: "Updated." }); }
  if (coll && m === "DELETE") { db[coll] = db[coll].filter((x) => x.id !== id); return json({ ok: true, message: "Deleted." }); }
  return json({ ok: false, error: "not mocked" }, 404);
};
window.__db = db;
window.confirm = () => true;
createRoot(document.getElementById("root")).render(<EntGeothermal setTab={(t) => (window.__tab = t)} />);
