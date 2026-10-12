import test from "node:test";
import assert from "node:assert/strict";
import {
  contractedMwhForPeriod, deliveryPerformance, resourceMix, rampComparison, rampStepAt,
  reserveMargin, costAllocationSummary, upstreamWater, milestoneSummary, monthsBetween,
} from "../lib/energy-water-portfolio.mjs";

const jan = ["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"]; // 744 h

test("contracted MWh: MW × hours × capacity factor, clipped to the delivery window", () => {
  const c = { contractedMw: 10, capacityFactorPct: 90 };
  assert.equal(contractedMwhForPeriod(c, ...jan), 10 * 744 * 0.9);
  const late = { ...c, deliveryStartAt: "2026-01-16T00:00:00Z" }; // 16 days = 384 h
  assert.equal(contractedMwhForPeriod(late, ...jan), 10 * 384 * 0.9);
  assert.equal(contractedMwhForPeriod({ ...c, deliveryEndAt: "2025-12-31T00:00:00Z" }, ...jan), 0);
});

test("contracted MWh prefers the stated annual MWh", () => {
  assert.equal(contractedMwhForPeriod({ contractedMw: 10, contractedAnnualMwh: 87600 }, ...jan), 87600 * 744 / 8760);
});

test("delivery performance compares only reported periods", () => {
  const contracts = [
    { id: "c1", name: "Geo", resourceType: "GEOTHERMAL", contractedMw: 10, capacityFactorPct: 100 },
    { id: "c2", name: "Solar", resourceType: "SOLAR", contractedMw: 5 },
  ];
  const deliveries = [{ contractId: "c1", periodStart: jan[0], periodEnd: jan[1], deliveredMwh: 6696, peakDeliveredMw: 9.5, curtailedMwh: 100 }];
  const r = deliveryPerformance(contracts, deliveries);
  const geo = r.contracts.find((x) => x.contractId === "c1");
  assert.equal(geo.contractedMwh, 7440);
  assert.equal(geo.deliveryPct, 90);
  assert.equal(geo.shortfallMwh, 744);
  assert.equal(geo.peakPct, 95);
  const solar = r.contracts.find((x) => x.contractId === "c2");
  assert.equal(solar.deliveredMwh, null); // nothing reported ≠ zero delivered
  assert.equal(r.totals.contractsReporting, 1);
  assert.equal(r.totals.deliveryPct, 90);
});

test("resource mix: carbon-free share counts only known carbon-free energy", () => {
  const contracts = [
    { id: "g", resourceType: "GEOTHERMAL", status: "ACTIVE", contractedMw: 10, firmCapacityMw: 9 },
    { id: "n", resourceType: "NUCLEAR", status: "PENDING_APPROVAL", contractedMw: 50 },
    { id: "x", resourceType: "GAS", status: "ACTIVE", contractedMw: 20 },
    { id: "m", resourceType: "GRID_MIX", status: "ACTIVE", contractedMw: 5 },
  ];
  const perf = { contracts: [
    { contractId: "g", resourceType: "GEOTHERMAL", deliveredMwh: 600 },
    { contractId: "x", resourceType: "GAS", deliveredMwh: 300 },
    { contractId: "m", resourceType: "GRID_MIX", deliveredMwh: 100 },
  ] };
  const assets = [{ type: "GAS_TURBINE", microgrid: true, status: "ACTIVE", ratedCapacityKw: 30000 }];
  const mix = resourceMix(contracts, assets, perf);
  assert.equal(mix.carbonFreeDeliveredPct, 60);
  assert.equal(mix.unknownMixDeliveredPct, 10);
  const gas = mix.resources.find((r) => r.resource === "GAS");
  assert.equal(gas.contractedMw, 20);
  assert.equal(gas.microgridMw, 30);
  assert.equal(mix.resources.find((r) => r.resource === "NUCLEAR").deliveredMwh, null);
});

test("ramp: planned load is the step in effect; actual is energy ÷ covered hours", () => {
  const steps = [
    { effectiveDate: "2026-01-01T00:00:00Z", phase: "CONSTRUCTION", plannedLoadMw: 2 },
    { effectiveDate: "2026-03-01T00:00:00Z", phase: "PEAK_OPERATION", plannedLoadMw: 100, plannedPeakMw: 120 },
  ];
  assert.equal(rampStepAt(steps, "2026-02-15T00:00:00Z").phase, "CONSTRUCTION");
  const actual = [{ month: "2026-01", kwh: 2.5e3 * 744, minutes: 744 * 60 }]; // 2.5 MW average
  const rows = rampComparison(steps, actual, { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-04-01T00:00:00Z") });
  assert.deepEqual(rows.map((r) => r.month), ["2026-01", "2026-02", "2026-03"]);
  assert.equal(rows[0].actualMw, 2.5);
  assert.equal(rows[0].variancePct, 25);
  assert.equal(rows[0].dataCoveragePct, 100);
  assert.equal(rows[1].actualMw, null); // no readings ≠ zero load
  assert.equal(rows[2].plannedPeakMw, 120);
});

test("reserve margin uses only entered firm capacity, now and at build-out", () => {
  const steps = [
    { effectiveDate: "2026-01-01T00:00:00Z", plannedLoadMw: 50, plannedPeakMw: 60 },
    { effectiveDate: "2027-01-01T00:00:00Z", plannedLoadMw: 180, plannedPeakMw: 200 },
  ];
  const contracts = [
    { id: "a", name: "Geo", status: "ACTIVE", firmCapacityMw: 50 },
    { id: "b", name: "Solar", status: "ACTIVE", firmCapacityMw: null },
    { id: "c", name: "Old", status: "TERMINATED", firmCapacityMw: 999 },
  ];
  const assets = [{ id: "t", name: "Gas turbines", microgrid: true, status: "ACTIVE", firmCapacityKw: 30000 }];
  const r = reserveMargin({ property: { id: "p", requiredReserveMarginPct: 15 }, contracts, assets, steps, at: new Date("2026-06-01T00:00:00Z") });
  assert.equal(r.firmCapacityMw, 80);
  assert.equal(r.currentMarginPct, 33.3);
  assert.equal(r.meetsRequirementNow, true);
  assert.equal(r.buildoutMarginPct, -60);
  assert.equal(r.meetsRequirementAtBuildout, false);
  assert.equal(r.buildoutFirmGapMw, 150); // 200 × 1.15 − 80
  assert.deepEqual(r.missingFirmCapacity.map((m) => m.name), ["Solar"]);
});

test("reserve margin is null without firm capacity or a load plan", () => {
  const r = reserveMargin({ property: {}, contracts: [], assets: [], steps: [] });
  assert.equal(r.firmCapacityMw, null);
  assert.equal(r.currentMarginPct, null);
});

test("cost allocation: customer vs ratepayer shares and unallocated remainder", () => {
  const s = costAllocationSummary([
    { category: "TRANSMISSION", status: "APPROVED", totalCost: 100, customerShare: 70, ratepayerShare: 30, otherShare: 0 },
    { category: "GENERATION", status: "ESTIMATED", totalCost: 200, customerShare: 150, ratepayerShare: 0, otherShare: 0 },
  ]);
  assert.equal(s.totalCost, 300);
  assert.equal(s.unallocated, 50);
  assert.equal(s.customerSharePct, 88); // 220 / 250
  assert.equal(s.ratepayerSharePct, 12);
  assert.equal(costAllocationSummary([]).totalCost, null);
});

test("upstream water only uses entered intensities and reports uncovered energy", () => {
  const r = upstreamWater({
    contracts: [{ id: "g", name: "Geo", resourceType: "GEOTHERMAL", waterIntensityGalPerMwh: 10 }, { id: "s", name: "Solar", resourceType: "SOLAR" }],
    performance: { contracts: [{ contractId: "g", deliveredMwh: 1000 }, { contractId: "s", deliveredMwh: 500 }] },
    properties: [{ id: "p", name: "DC", gridWaterIntensityGalPerMwh: 400 }],
    gridKwhByProperty: { p: 250000 },
  });
  assert.equal(r.upstreamGallons, 10000 + 250 * 400);
  assert.equal(r.uncoveredMwh, 500);
  assert.equal(r.coveragePct, 71.4); // 1250 / 1750
});

test("milestones: overdue, upcoming and expiring permits", () => {
  const at = new Date("2026-10-12T00:00:00Z");
  const s = milestoneSummary([
    { id: "1", title: "Air permit", status: "IN_PROGRESS", dueDate: "2026-10-01T00:00:00Z" },
    { id: "2", title: "Interconnection", status: "FILED", dueDate: "2026-11-15T00:00:00Z" },
    { id: "3", title: "Water right", status: "APPROVED", expiresAt: "2026-12-01T00:00:00Z" },
    { id: "4", title: "Done", status: "APPROVED", dueDate: "2026-01-01T00:00:00Z" },
  ], { at });
  assert.deepEqual(s.overdue.map((m) => m.id), ["1"]);
  assert.deepEqual(s.upcoming.map((m) => m.id), ["2"]);
  assert.deepEqual(s.expiringSoon.map((m) => m.id), ["3"]);
  assert.equal(s.open, 2);
});

test("monthsBetween spans year boundaries", () => {
  assert.deepEqual(monthsBetween(new Date("2026-11-15T00:00:00Z"), new Date("2027-02-01T00:00:00Z")), ["2026-11", "2026-12", "2027-01"]);
});
