import test from "node:test";
import assert from "node:assert/strict";
import { loadMetersAt, validateMeter, siteMonthlyLoad, meterEffectiveAt } from "../lib/energy-water-meters.mjs";

const from = "2026-01-01T00:00:00Z";
const main = (id, cov, extra = {}) => ({ id, name: id, meterLevel: "MAIN", coveragePct: cov, effectiveFrom: from, effectiveTo: null, parentMeterId: null, preferredSettlement: false, ...extra });
const oct = "2026-10"; // 744 h
const mwh = (mw, hours = 744) => mw * 1000 * hours; // kWh for a constant MW over `hours`

test("two non-overlapping main meters aggregate", () => {
  const meters = [main("A", 60), main("B", 40)];
  const load = siteMonthlyLoad(meters, [
    { month: oct, meterId: "A", kwh: mwh(30), minutes: 744 * 60 },
    { month: oct, meterId: "B", kwh: mwh(20), minutes: 744 * 60 },
  ])[oct];
  assert.equal(load.actualMw, 50);
  assert.equal(load.status, "COMPLETE");
  assert.equal(load.mode, "SUM_MAIN_METERS");
  assert.equal(load.meterCoveragePct, 100);
});

test("overlapping main-meter coverage is rejected", () => {
  const problems = validateMeter(main("C", 50), [main("A", 60), main("B", 40)]);
  assert.match(problems.join(" "), /Overlapping coverage/);
  // ...but fine once the earlier meter is retired before C starts
  const retired = [main("A", 60, { effectiveTo: "2026-06-01T00:00:00Z" }), main("B", 40)];
  assert.deepEqual(validateMeter(main("C", 60, { effectiveFrom: "2026-06-01T00:00:00Z" }), retired), []);
});

test("parent/sub-meter coverage is de-duplicated: sub-meters never add to site load", () => {
  const meters = [main("P", 100), { ...main("S", 100), meterLevel: "SUB", parentMeterId: "P" }];
  const load = siteMonthlyLoad(meters, [
    { month: oct, meterId: "P", kwh: mwh(40), minutes: 744 * 60 },
    { month: oct, meterId: "S", kwh: mwh(25), minutes: 744 * 60 },
  ])[oct];
  assert.equal(load.actualMw, 40);
  assert.deepEqual(load.meterIds, ["P"]);
});

test("CHECK meters are never summed", () => {
  const meters = [main("P", 100), { ...main("K", 100), meterLevel: "CHECK" }];
  const load = siteMonthlyLoad(meters, [
    { month: oct, meterId: "P", kwh: mwh(40), minutes: 744 * 60 },
    { month: oct, meterId: "K", kwh: mwh(41), minutes: 744 * 60 },
  ])[oct];
  assert.equal(load.actualMw, 40);
});

test("a preferred settlement meter is authoritative on its own (deterministic tie-break)", () => {
  const meters = [main("A", 60), main("B", 40),
    { ...main("U2", 100), meterLevel: "SETTLEMENT", preferredSettlement: true, settlementPriority: 2 },
    { ...main("U1", 100), meterLevel: "SETTLEMENT", preferredSettlement: true, settlementPriority: 1 }];
  assert.deepEqual(loadMetersAt(meters, "2026-10-15T00:00:00Z").meters.map((m) => m.id), ["U1"]);
  const load = siteMonthlyLoad(meters, [
    { month: oct, meterId: "A", kwh: mwh(30), minutes: 744 * 60 },
    { month: oct, meterId: "U1", kwh: mwh(51), minutes: 744 * 60 },
  ])[oct];
  assert.equal(load.actualMw, 51);
  assert.equal(load.mode, "PREFERRED_SETTLEMENT");
});

test("two preferred settlement meters with overlapping dates are rejected", () => {
  const existing = [{ ...main("U1", 100), meterLevel: "SETTLEMENT", preferredSettlement: true }];
  assert.match(validateMeter({ ...main("U2", 100), meterLevel: "SETTLEMENT", preferredSettlement: true }, existing).join(" "), /already the preferred settlement meter/);
});

test("partial coverage and missing meters are reported, never scaled up", () => {
  const meters = [main("A", 60), main("B", 40)];
  const load = siteMonthlyLoad(meters, [{ month: oct, meterId: "A", kwh: mwh(30), minutes: 744 * 60 }])[oct];
  assert.equal(load.actualMw, 30);
  assert.equal(load.status, "PARTIAL");
  assert.deepEqual(load.missingMeterIds, ["B"]);
  assert.equal(load.dataCoveragePct, 0);
  const lone = siteMonthlyLoad([main("A", 60)], [{ month: oct, meterId: "A", kwh: mwh(30), minutes: 744 * 60 }])[oct];
  assert.equal(lone.status, "PARTIAL"); // only 60% of the site is metered
  assert.equal(lone.actualMw, 30);
});

test("legacy sites without meters use unassigned readings; sites with meters ignore them", () => {
  const legacy = siteMonthlyLoad([], [{ month: oct, meterId: null, kwh: mwh(10), minutes: 744 * 60 }])[oct];
  assert.equal(legacy.actualMw, 10);
  assert.equal(legacy.mode, "LEGACY_UNASSIGNED");
  const metered = siteMonthlyLoad([main("A", 100)], [
    { month: oct, meterId: "A", kwh: mwh(12), minutes: 744 * 60 },
    { month: oct, meterId: null, kwh: mwh(99), minutes: 744 * 60, count: 3 },
  ])[oct];
  assert.equal(metered.actualMw, 12);
  assert.equal(metered.unassignedIgnored, 3);
});

test("hierarchy validation: sub needs a parent, no loops, coverage bounds, dates", () => {
  const P = main("P", 100), S = { ...main("S", 100), meterLevel: "SUB", parentMeterId: "P" };
  assert.match(validateMeter({ ...main("X", 100), meterLevel: "SUB" }, [P]).join(" "), /needs a parent/);
  assert.match(validateMeter({ ...P, parentMeterId: "S", meterLevel: "SUB" }, [P, S]).join(" "), /loop/);
  assert.match(validateMeter(main("Z", 0), []).join(" "), /Coverage/);
  assert.match(validateMeter(main("Z", 50, { effectiveTo: from }), []).join(" "), /Effective-to/);
  assert.equal(meterEffectiveAt(main("Z", 50, { effectiveTo: "2026-03-01T00:00:00Z" }), "2026-03-01T00:00:00Z"), false);
});

// ── Interval split at meter effective dates (load-ramp-v3-interval-split) ──
const at = (d) => `2026-10-${d}T00:00:00.000Z`;
const span = (meterId, d1, d2, mw, extra = {}) => { // readings for one meter from day d1 to d2 (exclusive), constant MW
  const hours = (Date.parse(at(d2)) - Date.parse(at(d1))) / 3600e3;
  return { month: oct, meterId, kwh: mwh(mw, hours), minutes: hours * 60, count: hours, firstAt: at(d1), lastEndAt: new Date(Date.parse(at(d2))).toISOString(), ...extra };
};
const d1 = "01", d15 = "15", d32 = "2026-11-01T00:00:00.000Z";
const toNov = (r) => ({ ...r, lastEndAt: d32 });

test("a meter swap mid-month splits the month at the effective dates", () => {
  // Old meter A until Oct 15 00:00, new meter B from then on.
  const meters = [main("A", 100, { effectiveTo: at(d15) }), main("B", 100, { effectiveFrom: at(d15) })];
  const rows = [span("A", d1, d15, 20), toNov({ ...span("B", d15, "31", 50), kwh: mwh(50, 17 * 24), minutes: 17 * 24 * 60 })];
  const load = siteMonthlyLoad(meters, rows)[oct];
  // 14 days at 20 MW + 17 days at 50 MW over 31 days
  const expected = (20 * 14 * 24 + 50 * 17 * 24) / 744;
  assert.equal(load.actualMw, Number(expected.toFixed(3)));
  assert.equal(load.status, "COMPLETE");
  assert.equal(load.allocation, "METER_EFFECTIVE_DATES");
  assert.equal(load.intervals.length, 2);
  assert.deepEqual(load.intervals.map((i) => i.meterIds), [["A"], ["B"]]);
  assert.equal(load.measuredMwh, 20 * 14 * 24 + 50 * 17 * 24);
  assert.equal(load.estimationMethod, undefined);
});

test("readings outside a meter's service dates are not counted in the other interval", () => {
  // A keeps reporting after it was retired; those readings must not add to B's interval.
  const meters = [main("A", 100, { effectiveTo: at(d15) }), main("B", 100, { effectiveFrom: at(d15) })];
  const late = { ...span("A", d15, "31", 99), lastEndAt: d32, kwh: mwh(99, 17 * 24), minutes: 17 * 24 * 60 };
  const rows = [span("A", d1, d15, 20), late, toNov({ ...span("B", d15, "31", 50), kwh: mwh(50, 17 * 24), minutes: 17 * 24 * 60 })];
  const load = siteMonthlyLoad(meters, rows)[oct];
  assert.equal(load.intervals[1].actualMw, 50);
  assert.equal(load.status, "COMPLETE");
});

test("parent and sub-meter readings are not double counted in any interval", () => {
  // Main P all month; sub-meter S under P installed mid-month.
  const meters = [main("P", 100), { ...main("S", 100, { effectiveFrom: at(d15) }), meterLevel: "SUB", parentMeterId: "P" }];
  const rows = [span("P", d1, d15, 40), toNov({ ...span("P", d15, "31", 40), kwh: mwh(40, 17 * 24), minutes: 17 * 24 * 60 }),
    toNov({ ...span("S", d15, "31", 25), kwh: mwh(25, 17 * 24), minutes: 17 * 24 * 60 })];
  const load = siteMonthlyLoad(meters, rows)[oct];
  assert.equal(load.actualMw, 40);
  assert.deepEqual(load.meterIds, ["P"]);
  assert.equal(load.intervals.length, 0); // a SUB meter change doesn't split site load
});

test("a main meter added mid-month only counts from its effective date", () => {
  // A covers 60% all month; B (40%) starts Oct 15 → first half PARTIAL coverage, second half COMPLETE.
  const meters = [main("A", 60), main("B", 40, { effectiveFrom: at(d15) })];
  const rows = [span("A", d1, d15, 30), toNov({ ...span("A", d15, "31", 30), kwh: mwh(30, 17 * 24), minutes: 17 * 24 * 60 }),
    toNov({ ...span("B", d15, "31", 20), kwh: mwh(20, 17 * 24), minutes: 17 * 24 * 60 })];
  const load = siteMonthlyLoad(meters, rows)[oct];
  assert.deepEqual(load.intervals.map((i) => [i.actualMw, i.status, i.meterCoveragePct]), [[30, "PARTIAL", 60], [50, "COMPLETE", 100]]);
  assert.equal(load.status, "PARTIAL");
  assert.equal(load.meterCoveragePct, 60);
  assert.equal(load.actualMw, Number(((30 * 14 + 50 * 17) / 31).toFixed(3)));
});

test("monthly totals only + meter change mid-month → ESTIMATED with the assumption disclosed", () => {
  const meters = [main("A", 100, { effectiveTo: at("10") }), main("B", 100, { effectiveFrom: at("10") })];
  // Monthly totals (no interval timestamps) — the month can't be split.
  const load = siteMonthlyLoad(meters, [
    { month: oct, meterId: "A", kwh: mwh(20, 9 * 24), minutes: 9 * 24 * 60 },
    { month: oct, meterId: "B", kwh: mwh(50, 22 * 24), minutes: 22 * 24 * 60 },
  ])[oct];
  assert.equal(load.status, "ESTIMATED");
  assert.notEqual(load.status, "COMPLETE");
  assert.equal(load.allocation, "MID_MONTH_ESTIMATE");
  assert.equal(load.estimationMethod, "MID_MONTH_METER_CONFIGURATION");
  assert.deepEqual(load.meterIds, ["B"]); // B is in service at mid-month
  assert.equal(load.actualMw, 50);
  assert.match(load.assumption, /mid-month/);
  assert.match(load.assumption, /estimate, not a verified figure/);
});

test("a single reading that spans a meter change makes the month ESTIMATED", () => {
  const meters = [main("A", 100, { effectiveTo: at(d15) }), main("B", 100, { effectiveFrom: at(d15) })];
  // One monthly-total reading for A recorded Oct 1 covering the whole month (44640 min).
  const load = siteMonthlyLoad(meters, [
    { month: oct, meterId: "A", kwh: mwh(30), minutes: 744 * 60, count: 1, firstAt: at(d1), lastEndAt: d32 },
    { ...span("B", d15, "20", 45) },
  ])[oct];
  assert.equal(load.status, "ESTIMATED");
  assert.equal(load.actualMw, 45); // B, the meter in service at mid-month
  assert.equal(load.coverageStatus, "COMPLETE"); // B covers the whole site…
  assert.equal(load.dataCoveragePct, Number((5 / 31 * 100).toFixed(1))); // …but reported only 5 days
  // With nothing from the mid-month meter there is nothing to estimate from.
  const none = siteMonthlyLoad(meters, [{ month: oct, meterId: "A", kwh: mwh(30), minutes: 744 * 60, count: 1, firstAt: at(d1), lastEndAt: d32 }])[oct];
  assert.equal(none.status, "UNAVAILABLE");
  assert.equal(none.actualMw, null);
});

test("monthly totals are fine (not estimated) when no meter changes during the month", () => {
  const load = siteMonthlyLoad([main("A", 100)], [{ month: oct, meterId: "A", kwh: mwh(12), minutes: 744 * 60 }])[oct];
  assert.equal(load.status, "COMPLETE");
  assert.equal(load.allocation, "METER_EFFECTIVE_DATES");
});

test("a gap between meters leaves that interval unavailable and the month partial", () => {
  const meters = [main("A", 100, { effectiveTo: at("10") }), main("B", 100, { effectiveFrom: at("20") })];
  const rows = [span("A", d1, "10", 10), toNov({ ...span("B", "20", "31", 10), kwh: mwh(10, 12 * 24), minutes: 12 * 24 * 60 })];
  const load = siteMonthlyLoad(meters, rows)[oct];
  assert.deepEqual(load.intervals.map((i) => i.status), ["COMPLETE", "UNAVAILABLE", "COMPLETE"]);
  assert.equal(load.status, "PARTIAL");
  assert.equal(load.actualMw, 10);
  assert.equal(load.dataCoveragePct, Number(((9 + 12) / 31 * 100).toFixed(1)));
});
