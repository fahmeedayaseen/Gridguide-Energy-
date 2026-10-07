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
