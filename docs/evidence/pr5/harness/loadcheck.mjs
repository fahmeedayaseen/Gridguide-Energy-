// Interval-split load check (formula load-ramp-v3-interval-split).
// Inserts readings into Postgres, runs the portfolio load SQL, feeds siteMonthlyLoad(),
// and compares with expected values worked out by hand for each scenario.
// Usage: node loadcheck.mjs /abs/path/lib/energy-water-meters.mjs
import { execFileSync } from "node:child_process";
const M = await import(process.argv[2]);
const psql = (sql) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", "gg_geo", "-At", "-q", "-v", "ON_ERROR_STOP=1"],
  { input: sql, env: { ...process.env, PGPASSWORD: "postgres" }, maxBuffer: 1 << 28 }).toString();
const H = 3600e3, OCT = Date.parse("2026-10-01T00:00:00Z"), NOV = Date.parse("2026-11-01T00:00:00Z");
const ts = (ms) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");
const meters = [], readings = [];
let n = 0;
const meter = (propertyId, id, level, cov, from, to = null, extra = {}) =>
  meters.push({ id, orgId: "org1", propertyId, name: id, meterLevel: level, coveragePct: cov, effectiveFrom: new Date(from).toISOString(), effectiveTo: to && new Date(to).toISOString(), parentMeterId: null, preferredSettlement: false, ...extra });
const series = (propertyId, meterId, fromMs, toMs, mw, stepMin = 60, extra = {}) => {
  for (let t = fromMs; t < toMs; t += stepMin * 60e3)
    readings.push({ id: `r${n++}`, orgId: "org1", propertyId, meterId, recordedAt: t, intervalMinutes: stepMin, kwh: mw * 1000 * stepMin / 60, updatedAt: "2026-10-20 00:00:00", ...extra });
};
const swap = Date.parse("2026-10-15T12:30:00Z"), d10 = Date.parse("2026-10-10T00:00:00Z"), d15 = Date.parse("2026-10-15T00:00:00Z");

// S1 swap at 12:30 (15-min readings); retired meter A keeps reporting at 99 MW (must be ignored)
meter("s1", "s1A", "MAIN", 100, "2026-01-01T00:00:00Z", swap); meter("s1", "s1B", "MAIN", 100, swap);
series("s1", "s1A", OCT, swap, 20, 15); series("s1", "s1A", swap, NOV, 99, 15); series("s1", "s1B", swap, NOV, 50, 15);
// S2 parent + sub (from Oct 10) + check meter: only P counts
meter("s2", "s2P", "MAIN", 100, "2026-01-01T00:00:00Z"); meter("s2", "s2S", "SUB", 100, d10, null, { parentMeterId: "s2P" }); meter("s2", "s2K", "CHECK", 100, "2026-01-01T00:00:00Z");
series("s2", "s2P", OCT, NOV, 40); series("s2", "s2S", d10, NOV, 25); series("s2", "s2K", OCT, NOV, 41);
// S3 duplicate readings per meter+timestamp: latest update (30 MW) wins over stale 999 MW copies
meter("s3", "s3A", "MAIN", 100, "2026-01-01T00:00:00Z");
series("s3", "s3A", OCT, NOV, 999, 60, { updatedAt: "2026-10-01 00:00:00" }); series("s3", "s3A", OCT, NOV, 30);
// S4 monthly totals only across a meter change → ESTIMATED (B in service at mid-month)
meter("s4", "s4A", "MAIN", 100, "2026-01-01T00:00:00Z", d10); meter("s4", "s4B", "MAIN", 100, d10);
series("s4", "s4A", OCT, NOV, 20, 44640); series("s4", "s4B", OCT, NOV, 50, 44640);
// S5 second main meter added Oct 15: A 60% @30 MW all month, B 40% @20 MW from Oct 15
meter("s5", "s5A", "MAIN", 60, "2026-01-01T00:00:00Z"); meter("s5", "s5B", "MAIN", 40, d15);
series("s5", "s5A", OCT, NOV, 30); series("s5", "s5B", d15, NOV, 20);
// S6 legacy site, no meters: unassigned site-level readings
series("s6", null, OCT, NOV, 10);
// Noise: another org's readings on the same site ids must not leak in
series("s1", "s1B", OCT, NOV, 500, 60, { orgId: "other" });

const h1 = (swap - OCT) / H, h2 = (NOV - swap) / H, h15a = (d15 - OCT) / H, h15b = (NOV - d15) / H;
const r3 = (v) => Number(v.toFixed(3));
const expected = {
  s1: { actualMw: r3((20 * h1 + 50 * h2) / 744), status: "COMPLETE", allocation: "METER_EFFECTIVE_DATES", intervals: 2, measuredMwh: r3(20 * h1 + 50 * h2) },
  s2: { actualMw: 40, status: "COMPLETE", allocation: "METER_EFFECTIVE_DATES", intervals: 0, measuredMwh: 40 * 744 },
  s3: { actualMw: 30, status: "COMPLETE", allocation: "METER_EFFECTIVE_DATES", intervals: 0, measuredMwh: 30 * 744 },
  s4: { actualMw: 50, status: "ESTIMATED", allocation: "MID_MONTH_ESTIMATE", intervals: 0, measuredMwh: 50 * 744 },
  s5: { actualMw: r3((30 * h15a + 50 * h15b) / 744), status: "PARTIAL", allocation: "METER_EFFECTIVE_DATES", intervals: 2, measuredMwh: r3(30 * 744 + 20 * h15b) },
  s6: { actualMw: 10, status: "COMPLETE", allocation: "METER_EFFECTIVE_DATES", intervals: 0, measuredMwh: 10 * 744 },
};

const lit = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" || typeof v === "boolean" ? String(v) : `'${v}'`);
psql(`DELETE FROM "EnterpriseSustainabilityReading"; DELETE FROM "EnterpriseMeter";`);
psql(`INSERT INTO "EnterpriseMeter" ("id","orgId","propertyId","name","meterLevel","parentMeterId","coveragePct","effectiveFrom","effectiveTo","preferredSettlement","updatedAt") VALUES ` +
  meters.map((m) => `(${[m.id, m.orgId, m.propertyId, m.name, m.meterLevel, m.parentMeterId, m.coveragePct, m.effectiveFrom.replace("T", " ").replace("Z", ""), m.effectiveTo && m.effectiveTo.replace("T", " ").replace("Z", ""), m.preferredSettlement].map(lit).join(",")},now())`).join(",") + ";");
for (let i = 0; i < readings.length; i += 5000) {
  psql(`INSERT INTO "EnterpriseSustainabilityReading" ("id","orgId","propertyId","meterId","recordedAt","intervalMinutes","facilityEnergyKwh","updatedAt") VALUES ` +
    readings.slice(i, i + 5000).map((r) => `(${[r.id, r.orgId, r.propertyId, r.meterId, ts(r.recordedAt), r.intervalMinutes, r.kwh, r.updatedAt].map(lit).join(",")})`).join(",") + ";");
}
const where = `"orgId" = $1
      AND "recordedAt" >= ($2::timestamptz AT TIME ZONE 'UTC') AND "recordedAt" < ($3::timestamptz AT TIME ZONE 'UTC')
      AND "facilityEnergyKwh" IS NOT NULL AND ("meterId" IS NOT NULL OR "assetId" IS NULL)`;
let sql = M.buildLoadIntervalSql(where);
["org1", "2026-09-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z"].forEach((p, i) => { sql = sql.replaceAll(`$${i + 1}`, `'${p}'`); });
// Non-UTC session time zone: results must not shift.
const out = psql(`SET TIME ZONE 'America/Indiana/Indianapolis'; SELECT COALESCE(json_agg(t), '[]') FROM (${sql}) t;`).trim();
const rows = JSON.parse(out);
console.log(`readings inserted=${readings.length} meters=${meters.length} sql rows=${rows.length}`);
let fail = 0;
for (const site of Object.keys(expected)) {
  const siteMeters = meters.filter((m) => m.propertyId === site);
  const mm = rows.filter((r) => r.propertyId === site).map((r) => ({ month: r.month, meterId: r.meterId, kwh: r.kwh, minutes: r.minutes, count: r.count, firstAt: r.firstAt, lastEndAt: r.lastEndAt }));
  const got = M.siteMonthlyLoad(siteMeters, mm)["2026-10"];
  const e = expected[site];
  const g = { actualMw: got.actualMw, status: got.status, allocation: got.allocation, intervals: got.intervals.length, measuredMwh: got.measuredMwh };
  const ok = Object.keys(e).every((k) => (typeof e[k] === "number" ? Math.abs(e[k] - g[k]) <= 0.001 : e[k] === g[k]));
  if (!ok) fail++;
  console.log(`${site} ${ok ? "PASS" : "FAIL"} got=${JSON.stringify(g)}${ok ? "" : ` expected=${JSON.stringify(e)}`}${got.assumption ? `\n   assumption: ${got.assumption}` : ""}${got.intervals.length ? `\n   intervals: ${got.intervals.map((i) => `${i.from.slice(5, 16)}→${i.to.slice(5, 16)} ${i.meterIds.join("+")} ${i.actualMw} MW ${i.status}`).join(" | ")}` : ""}`);
}
console.log(fail ? `FAILED ${fail}` : "ALL PASS");
process.exitCode = fail ? 1 : 0;
