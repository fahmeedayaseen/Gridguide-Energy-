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
    waterReclaimedImportedGallons: 0,
    waterDischargedGallons: 0,
    carbonAvoidedKg: 350,
  }]);
  assert.equal(result.efficiency.pue, 1.2);
  assert.equal(result.efficiency.wueLitersPerItKwh, 0.379);
  assert.equal(result.efficiency.geothermalCoveragePct, 75);
  assert.equal(result.efficiency.coolingSharePct, 10);
  assert.equal(result.efficiency.recycledWaterSharePct, 20); // 200 / (800 + 0 + 200)
  assert.equal(result.totals.waterSavedGallons, 250);
});

test("returns null efficiency ratios instead of fake zeroes without denominators", () => {
  const result = calculateEnergyWaterMetrics([]);
  assert.equal(result.efficiency.pue, null);
  assert.equal(result.efficiency.wueLitersPerItKwh, null);
  assert.equal(result.efficiency.geothermalCoveragePct, null);
  assert.equal(result.efficiency.recycledWaterSharePct, null);
});

const fullWater0 = { waterReclaimedImportedGallons: 0, waterConsumedGallons: 0, waterDischargedGallons: 0 };
test("recycled water share uses on-site recycled / (potable + reclaimed imported + recycled)", () => {
  const result = calculateEnergyWaterMetrics([{ ...fullWater0, waterWithdrawnGallons: 100, waterRecycledGallons: 50 }]);
  assert.equal(result.efficiency.recycledWaterSharePct, 33.3);
  const withImport = calculateEnergyWaterMetrics([{ ...fullWater0, waterWithdrawnGallons: 100, waterReclaimedImportedGallons: 50, waterRecycledGallons: 50 }]);
  assert.equal(withImport.efficiency.recycledWaterSharePct, 25);
  assert.equal(withImport.efficiency.nonPotableSharePct, 50);
});

test("recycled water share is null unless the reading has complete water data", () => {
  const result = calculateEnergyWaterMetrics([{ waterWithdrawnGallons: 100, waterRecycledGallons: 50 }]);
  assert.equal(result.efficiency.recycledWaterSharePct, null);
});

test("recycled water share is null when no water volumes are reported", () => {
  const result = calculateEnergyWaterMetrics([{ itEnergyKwh: 1000, facilityEnergyKwh: 1200, waterWithdrawnGallons: 0, waterRecycledGallons: 0 }]);
  assert.equal(result.efficiency.recycledWaterSharePct, null);
});

test("recycled water share never exceeds 100%", () => {
  const result = calculateEnergyWaterMetrics([{ ...fullWater0, waterWithdrawnGallons: 0, waterRecycledGallons: 500 }]);
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
    w_imported: agg.water.imported, w_recycled: agg.water.recycled, w_consumed: agg.water.consumed,
    w_discharged: agg.water.discharged, w_storage: agg.water.storage, w_storage_n: agg.water.storageN });
  const { metrics, trend } = metricsFromDailySqlRows([row]);
  const strip = (m) => JSON.parse(JSON.stringify(m, (k, v) => (k === "calculated_at" ? undefined : v)));
  assert.deepEqual(strip(metrics), strip(calculateEnergyWaterMetrics(readings)));
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

// ── Verified water claims (handoff acceptance tests, formula water-balance-v2) ──
import { waterClaimStatus, combineWaterClaims, WATER_FORMULA_VERSION } from "../lib/geothermal-metrics.mjs";

const full = {
  waterWithdrawnGallons: 1000, waterReclaimedImportedGallons: 0, waterRecycledGallons: 400,
  waterConsumedGallons: 700, waterDischargedGallons: 300,
};
const claimFor = (readings) => calculateEnergyWaterMetrics(readings).waterClaim;
// Inputs 1000; choose outputs to hit an exact variance.
const withVariance = (pct) => ({ ...full, waterConsumedGallons: 700, waterDischargedGallons: 300 - pct * 10 });

test("status object has the documented fields", () => {
  const c = claimFor([full]);
  for (const k of ["verification_status", "missing_measurements", "balance_variance_pct", "verification_reasons", "formula_version", "calculated_at"]) assert.ok(k in c, k);
  assert.equal(c.formula_version, WATER_FORMULA_VERSION);
  assert.ok(c.verification_reasons.every((r) => typeof r.code === "string" && typeof r.message === "string"));
});

for (const field of ["waterWithdrawnGallons", "waterConsumedGallons", "waterDischargedGallons", "waterReclaimedImportedGallons"]) {
  test(`missing ${field} yields UNVERIFIED and names the field`, () => {
    const { [field]: _omit, ...partial } = full;
    const c = claimFor([full, partial]);
    assert.equal(c.verification_status, "UNVERIFIED");
    assert.deepEqual(c.missing_measurements, [field]);
    assert.equal(c.verification_reasons[0].code, "MISSING_MEASUREMENTS");
    assert.equal(c.balance_variance_pct, null);
  });
}

test("4.9% variance verifies, 5.1% needs review, 10.1% is unverified (5.0 / 10.0 are inclusive)", () => {
  assert.equal(claimFor([withVariance(4.9)]).verification_status, "VERIFIED");
  assert.equal(claimFor([withVariance(5.0)]).verification_status, "VERIFIED");
  assert.equal(claimFor([withVariance(5.1)]).verification_status, "REVIEW");
  assert.equal(claimFor([withVariance(10.0)]).verification_status, "REVIEW");
  assert.equal(claimFor([withVariance(10.1)]).verification_status, "UNVERIFIED");
  assert.equal(claimFor([withVariance(5.1)]).balance_variance_pct, 5.1);
});

test("onsite recycled water is NOT an input; imported reclaimed water IS", () => {
  // Recycled 5,000 gal would wreck the balance if it were counted as input.
  assert.equal(claimFor([{ ...full, waterRecycledGallons: 5000 }]).verification_status, "VERIFIED");
  // 200 gal imported reclaimed water must be matched by outputs.
  const imported = { ...full, waterReclaimedImportedGallons: 200 };
  assert.equal(claimFor([imported]).verification_status, "UNVERIFIED"); // 1200 in vs 1000 out = 16.7%
  assert.equal(claimFor([{ ...imported, waterDischargedGallons: 500 }]).verification_status, "VERIFIED");
});

test("storage change closes the balance and is flagged when not reported", () => {
  const filling = { ...full, waterDischargedGallons: 200 }; // 1000 in, 900 out → 10% gap
  assert.equal(claimFor([filling]).verification_status, "REVIEW");
  const withStorage = claimFor([{ ...filling, waterStorageChangeGallons: 100 }]);
  assert.equal(withStorage.verification_status, "VERIFIED");
  assert.ok(claimFor([full]).verification_reasons.some((r) => r.code === "STORAGE_CHANGE_NOT_REPORTED"));
  assert.ok(!withStorage.verification_reasons.some((r) => r.code === "STORAGE_CHANGE_NOT_REPORTED"));
});

test("no water readings is UNVERIFIED with a reason, and energy-only readings don't count", () => {
  const c = claimFor([{ itEnergyKwh: 5 }]);
  assert.equal(c.verification_status, "UNVERIFIED");
  assert.equal(c.verification_reasons[0].code, "NO_WATER_READINGS");
});

test("WUE, recycled share and water saved inherit the period's evidence status", () => {
  assert.equal(calculateEnergyWaterMetrics([withVariance(7)]).waterEvidenceStatus, "REVIEW");
});

test("portfolio claim exposes the least-trusted site", () => {
  const verified = { key: "a", label: "Site A", claim: claimFor([full]) };
  const review = { key: "b", label: "Site B", claim: claimFor([withVariance(7)]) };
  const missing = { key: "c", label: "Site C", claim: claimFor([full, { waterWithdrawnGallons: 5 }]) };
  assert.equal(combineWaterClaims([verified, review]).verification_status, "REVIEW");
  const all = combineWaterClaims([verified, review, missing]);
  assert.equal(all.verification_status, "UNVERIFIED");
  assert.ok(all.missing_measurements.includes("waterDischargedGallons"));
  assert.deepEqual(all.contributors.map((c) => c.verification_status), ["VERIFIED", "REVIEW", "UNVERIFIED"]);
});

test("SQL rows grouped by property produce a least-trusted combined claim", () => {
  const toRow = (day, propertyId, readings) => {
    const agg = aggregateReadings(readings);
    const row = { day, propertyId, n: agg.readingCount };
    for (const f of MEASUREMENT_FIELDS) { row[`s_${f}`] = agg.sums[f]; row[`c_${f}`] = agg.counts[f]; }
    for (const [p, v] of Object.entries(agg.pairs)) { row[`pa_${p}`] = v.a; row[`pb_${p}`] = v.b; row[`pn_${p}`] = v.n; }
    Object.assign(row, { w_any: agg.water.anyN, w_complete: agg.water.completeN, w_withdrawn: agg.water.withdrawn, w_imported: agg.water.imported,
      w_recycled: agg.water.recycled, w_consumed: agg.water.consumed, w_discharged: agg.water.discharged, w_storage: agg.water.storage, w_storage_n: agg.water.storageN });
    return row;
  };
  const { metrics, siteWaterClaims } = metricsFromDailySqlRows([toRow("2026-10-01", "a", [full]), toRow("2026-10-01", "b", [withVariance(12)])], { propertyLabels: { a: "A", b: "B" } });
  assert.equal(siteWaterClaims.length, 2);
  assert.equal(metrics.waterClaim.verification_status, "UNVERIFIED");
  assert.ok(metrics.waterClaim.verification_reasons.some((r) => r.scope === "B" && r.code === "BALANCE_EXCEEDS_THRESHOLD"));
});
