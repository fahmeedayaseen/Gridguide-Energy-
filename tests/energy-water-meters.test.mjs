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
