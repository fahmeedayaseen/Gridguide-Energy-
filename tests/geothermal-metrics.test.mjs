import test from "node:test";
import assert from "node:assert/strict";
import { calculateEnergyWaterMetrics, estimatePpaValue } from "../lib/geothermal-metrics.mjs";

test("calculates PUE, WUE, geothermal coverage, and recycled water share", () => {
  const result = calculateEnergyWaterMetrics([{
    facilityEnergyKwh: 1200,
    itEnergyKwh: 1000,
    geothermalDeliveredKwh: 900,
    gridEnergyKwh: 300,
    coolingEnergyKwh: 120,
    waterWithdrawnGallons: 800,
    waterConsumedGallons: 100,
    baselineWaterConsumedGallons: 350,
    waterRecycledGallons: 200,
    carbonAvoidedKg: 350,
  }]);
  assert.equal(result.efficiency.pue, 1.2);
  assert.equal(result.efficiency.wueLitersPerItKwh, 0.379);
  assert.equal(result.efficiency.geothermalCoveragePct, 75);
  assert.equal(result.efficiency.coolingSharePct, 10);
  assert.equal(result.efficiency.recycledWaterSharePct, 20);
  assert.equal(result.totals.waterSavedGallons, 250);
});

test("returns null efficiency ratios instead of fake zeroes without denominators", () => {
  const result = calculateEnergyWaterMetrics([]);
  assert.equal(result.efficiency.pue, null);
  assert.equal(result.efficiency.wueLitersPerItKwh, null);
  assert.equal(result.efficiency.geothermalCoveragePct, null);
  assert.equal(result.efficiency.recycledWaterSharePct, null);
});

test("recycled water share uses recycled / (withdrawn + recycled)", () => {
  const result = calculateEnergyWaterMetrics([{ waterWithdrawnGallons: 100, waterRecycledGallons: 50 }]);
  assert.equal(result.efficiency.recycledWaterSharePct, 33.3);
});

test("recycled water share is null when no water volumes are reported", () => {
  const result = calculateEnergyWaterMetrics([{ itEnergyKwh: 1000, facilityEnergyKwh: 1200, waterWithdrawnGallons: 0, waterRecycledGallons: 0 }]);
  assert.equal(result.efficiency.recycledWaterSharePct, null);
});

test("recycled water share never exceeds 100%", () => {
  const result = calculateEnergyWaterMetrics([{ waterWithdrawnGallons: 0, waterRecycledGallons: 500 }]);
  assert.equal(result.efficiency.recycledWaterSharePct, 100);
});

test("estimates a priced PPA and leaves confidential pricing unknown", () => {
  const priced = estimatePpaValue({ contractedMw: 10, capacityFactorPct: 90, pricePerMwh: 80, termYears: 2, annualEscalationPct: 0 });
  assert.equal(priced.annualMwh, 78840);
  assert.equal(priced.estimatedContractValue, 12614400);
  assert.equal(estimatePpaValue({ contractedMw: 10, pricePerMwh: null, termYears: 20 }), null);
});

// ── Missing is not zero (Oct 2026) ────────────────────────────────────────────
import {
  aggregateReadings, mergeAggregates, metricsFromAggregate, metricsFromDailySqlRows,
  buildDailyAggregateSql, MEASUREMENT_FIELDS, measurement,
} from "../lib/geothermal-metrics.mjs";

test("totals are null for measurements nobody reported", () => {
  const result = calculateEnergyWaterMetrics([{ facilityEnergyKwh: 100, itEnergyKwh: 80 }]);
  assert.equal(result.totals.facilityEnergyKwh, 100);
  assert.equal(result.totals.waterConsumedGallons, null);
  assert.equal(result.totals.waterSavedGallons, null);
  assert.equal(result.reportedCounts.waterConsumedGallons, 0);
});

test("ratios only use readings that reported both inputs", () => {
  // Reading 2 has facility energy but no IT energy — it must not inflate PUE.
  const result = calculateEnergyWaterMetrics([
    { facilityEnergyKwh: 120, itEnergyKwh: 100 },
    { facilityEnergyKwh: 500 },
  ]);
  assert.equal(result.efficiency.pue, 1.2);
  assert.equal(result.totals.facilityEnergyKwh, 620);
});

test("an explicit zero is a real measurement, null/blank is not", () => {
  assert.equal(measurement(0), 0);
  assert.equal(measurement(""), null);
  assert.equal(measurement(null), null);
  assert.equal(measurement(undefined), null);
  assert.equal(measurement("abc"), null);
  const result = calculateEnergyWaterMetrics([{ waterConsumedGallons: 0 }]);
  assert.equal(result.totals.waterConsumedGallons, 0);
});

test("merged daily aggregates equal one aggregate over all readings", () => {
  const a = [{ facilityEnergyKwh: 10, itEnergyKwh: 8, waterRecycledGallons: 5, waterWithdrawnGallons: 15 }];
  const b = [{ facilityEnergyKwh: 30, itEnergyKwh: 20 }, { waterConsumedGallons: 7 }];
  const merged = metricsFromAggregate(mergeAggregates([aggregateReadings(a), aggregateReadings(b)]));
  assert.deepEqual(merged, calculateEnergyWaterMetrics([...a, ...b]));
});

test("SQL row shape converts to the same metrics as the JS path", () => {
  const readings = [{ facilityEnergyKwh: 120, itEnergyKwh: 100, waterWithdrawnGallons: 100, waterRecycledGallons: 50 }];
  const agg = aggregateReadings(readings);
  const row = { day: "2026-10-01", n: agg.readingCount };
  for (const f of MEASUREMENT_FIELDS) { row[`s_${f}`] = agg.sums[f]; row[`c_${f}`] = agg.counts[f]; }
  for (const [p, v] of Object.entries(agg.pairs)) { row[`pa_${p}`] = v.a; row[`pb_${p}`] = v.b; row[`pn_${p}`] = v.n; }
  Object.assign(row, { w_any: agg.water.anyN, w_complete: agg.water.completeN, w_withdrawn: agg.water.withdrawn,
    w_consumed: agg.water.consumed, w_discharged: agg.water.discharged, w_recycled: agg.water.recycled });
  const { metrics, trend } = metricsFromDailySqlRows([row]);
  assert.deepEqual(metrics, calculateEnergyWaterMetrics(readings));
  assert.equal(trend[0].date, "2026-10-01");
});

test("aggregate SQL binds every value as a parameter", () => {
  const { sql, params } = buildDailyAggregateSql({
    orgId: "org'; DROP TABLE x;--", from: new Date("2026-01-01"), to: new Date("2026-02-01"), propertyId: "p1",
  });
  assert.ok(!sql.includes("DROP TABLE"));
  assert.equal(params.length, 4);
  assert.match(sql, /\$4/);
  assert.equal(params[1], "2026-01-01T00:00:00.000Z");
});

// ── Verified water claims ─────────────────────────────────────────────────────
const fullWater = { waterWithdrawnGallons: 1000, waterConsumedGallons: 700, waterDischargedGallons: 280, waterRecycledGallons: 400 };

test("water claim is VERIFIED only with all four measurements and a closed balance", () => {
  const ok = calculateEnergyWaterMetrics([fullWater]).waterClaim;
  assert.equal(ok.status, "VERIFIED");
  assert.equal(ok.balanceGapPct, 2); // |1000 - (700 + 280)| / 1000
});

test("missing discharge makes the claim INCOMPLETE and names the field", () => {
  const { waterDischargedGallons, ...noDischarge } = fullWater;
  const claim = calculateEnergyWaterMetrics([fullWater, noDischarge]).waterClaim;
  assert.equal(claim.status, "INCOMPLETE");
  assert.deepEqual(claim.missingFields, ["waterDischargedGallons"]);
});

test("a water balance that doesn't close is UNBALANCED", () => {
  const claim = calculateEnergyWaterMetrics([{ ...fullWater, waterDischargedGallons: 0 }]).waterClaim;
  assert.equal(claim.status, "UNBALANCED");
  assert.equal(claim.verified, false);
});

test("no water readings means NO_DATA, and energy-only readings don't count", () => {
  assert.equal(calculateEnergyWaterMetrics([{ itEnergyKwh: 5 }]).waterClaim.status, "NO_DATA");
});
