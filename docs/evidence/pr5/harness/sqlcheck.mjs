// Compare the SQL aggregation with the JS aggregation on the same random data.
import { execFileSync } from "node:child_process";
const m = await import(process.argv[2]);
const rnd = (p = 0.85) => (Math.random() < p ? +(Math.random() * 1000).toFixed(3) : null);
const rows = [];
const base = Date.parse("2026-09-01T00:00:00Z");
for (let i = 0; i < 400; i++) {
  const r = { id: `r${i}`, orgId: i % 7 === 0 ? "other" : "org1", propertyId: i % 3 === 0 ? "p2" : "p1",
    recordedAt: new Date(base + i * 3.7 * 3600e3).toISOString() };
  for (const f of m.MEASUREMENT_FIELDS) r[f] = rnd();
  if (r.waterStorageChangeGallons !== null) r.waterStorageChangeGallons -= 500; // signed
  if (process.env.TIERS) { // only complete water readings: p1 ≈ 2% variance, p2 ≈ 7%
    Object.assign(r, { waterWithdrawnGallons: 900, waterReclaimedImportedGallons: 100, waterRecycledGallons: 250,
      waterConsumedGallons: 600, waterDischargedGallons: r.propertyId === "p1" ? 380 : 330, waterStorageChangeGallons: null, baselineWaterConsumedGallons: 800 });
  }
  // Some readings get a near-balanced complete water set so every status tier occurs.
  if (i % 5 === 0) Object.assign(r, { waterWithdrawnGallons: 1000, waterReclaimedImportedGallons: 100, waterRecycledGallons: 300,
    waterConsumedGallons: 700, waterDischargedGallons: 400 - (i % 3) * 40, waterStorageChangeGallons: i % 2 ? null : 0 });
  rows.push(r);
}
const statuses = [];
function diff(a, b, path = "") {
  if (path.endsWith("calculated_at")) return [];
  if (typeof a !== "object" || a === null) {
    const close = typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 0.011; // rounding of float sums
    return a === b || close ? [] : [`${path}: ${a} vs ${b}`];
  }
  return Object.keys({ ...a, ...b }).flatMap((k) => diff(a?.[k], b?.[k], `${path}.${k}`));
}
const lit = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v}'`);
const cols = ["id", "orgId", "propertyId", "recordedAt", ...m.MEASUREMENT_FIELDS];
const insert = `SET TIME ZONE 'America/Indiana/Indianapolis'; DELETE FROM "EnterpriseSustainabilityReading"; INSERT INTO "EnterpriseSustainabilityReading" (${cols.map((c) => `"${c}"`).join(",")}) VALUES ` +
  rows.map((r) => `(${cols.map((c) => c === "recordedAt" ? `'${r.recordedAt.replace("T", " ").replace("Z", "")}'` : lit(r[c])).join(",")})`).join(",") + ";";
const psql = (sql) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", "gg_geo", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { env: { ...process.env, PGPASSWORD: "postgres" } }).toString();
psql(insert);

const from = new Date("2026-09-05T00:00:00Z"), to = new Date("2026-10-20T00:00:00Z");
for (const propertyId of [null, "p1"]) {
  const { sql, params } = m.buildDailyAggregateSql({ orgId: "org1", from, to, propertyId });
  // inline params for psql
  let inlined = sql; params.forEach((p, i) => { inlined = inlined.replaceAll(`$${i + 1}`, `'${p}'`); });
  const json = psql(`SET TIME ZONE 'America/Indiana/Indianapolis'; SELECT COALESCE(json_agg(t), '[]') FROM (${inlined}) t;`).replace(/^SET\n/, "").trim();
  const viaSql = m.metricsFromDailySqlRows(JSON.parse(json));
  const subset = rows.filter((r) => r.orgId === "org1" && (!propertyId || r.propertyId === propertyId) && new Date(r.recordedAt) >= from && new Date(r.recordedAt) < to);
  const viaJs = { metrics: m.calculateEnergyWaterMetrics(subset), trend: m.buildDailyTrend(subset) };
  // Per-site claims, combined least-trusted-first, must match the SQL path.
  const props = [...new Set(subset.map((r) => r.propertyId))].sort();
  const jsSite = props.map((p) => ({ key: p, label: p, claim: m.calculateEnergyWaterMetrics(subset.filter((r) => r.propertyId === p)).waterClaim }));
  if (props.length > 1) { viaJs.metrics.waterClaim = m.combineWaterClaims(jsSite); viaJs.metrics.waterEvidenceStatus = viaJs.metrics.waterClaim.verification_status; }
  viaJs.siteWaterClaims = jsSite.map((c) => ({ propertyId: c.key, label: c.label, ...c.claim }));
  statuses.push(viaSql.metrics.waterClaim.verification_status, ...viaSql.siteWaterClaims.map((c) => c.verification_status));
  const same = diff(viaSql, viaJs).length === 0;
  console.log(`property=${propertyId ?? "all"} readings=${subset.length} days=${viaSql.trend.length} match=${same}`);
  if (!same) {
    console.log("metrics diff:", diff(viaSql.metrics, viaJs.metrics));
    viaSql.trend.forEach((d, i) => { const j = viaJs.trend[i]; if (JSON.stringify(d) !== JSON.stringify(j)) console.log("day", d.date, j?.date, JSON.stringify(d).slice(0,0), diff(d, j)); });
    process.exitCode = 1;
  }
}
console.log("statuses seen:", [...new Set(statuses)].sort().join(","));
