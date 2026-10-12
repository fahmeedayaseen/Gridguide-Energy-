import test from "node:test";
import assert from "node:assert/strict";

const s = await import("../lib/energy-water-schemas.js");
const g = await import("../lib/geothermal-schemas.js");

test("cost shares can't exceed the total", () => {
  const base = { category: "TRANSMISSION", description: "Line", totalCost: 100 };
  assert.equal(s.costCreateSchema.safeParse({ ...base, customerShare: 70, ratepayerShare: 30 }).success, true);
  assert.equal(s.costCreateSchema.safeParse({ ...base, customerShare: 70, ratepayerShare: 40 }).success, false);
  assert.equal(s.sharesWithinTotal({ totalCost: 100, customerShare: 60, ratepayerShare: 40, otherShare: 0.005 }), true);
});

test("deliveries need periodEnd after periodStart and at most ~13 months", () => {
  const d = { contractId: "c", deliveredMwh: 10, periodStart: "2026-01-01T00:00:00Z" };
  assert.equal(s.deliveryCreateSchema.safeParse({ ...d, periodEnd: "2026-02-01T00:00:00Z" }).success, true);
  assert.equal(s.deliveryCreateSchema.safeParse({ ...d, periodEnd: "2026-01-01T00:00:00Z" }).success, false);
  assert.equal(s.deliveryCreateSchema.safeParse({ ...d, periodEnd: "2027-06-01T00:00:00Z" }).success, false);
});

test("delivery batches report failing rows", () => {
  const ok = { contractId: "c", deliveredMwh: 1, periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-02-01T00:00:00Z" };
  const { rows, errors } = s.validateDeliveriesBody({ deliveries: [ok, { ...ok, deliveredMwh: -1 }] });
  assert.equal(rows, null);
  assert.deepEqual(errors.map((e) => e.row), [2]);
});

test("milestones accept only http(s) reference links", () => {
  const m = { category: "PERMIT", title: "Air permit" };
  assert.equal(s.milestoneCreateSchema.safeParse({ ...m, referenceUrl: "https://puc.example.gov/docket/1" }).success, true);
  assert.equal(s.milestoneCreateSchema.safeParse({ ...m, referenceUrl: "javascript:alert(1)" }).success, false);
  assert.equal(s.milestoneCreateSchema.parse({ ...m, referenceUrl: "" }).referenceUrl, null);
});

test("ramp steps require a site, date, phase and planned load", () => {
  assert.equal(s.rampStepCreateSchema.safeParse({ propertyId: "p", effectiveDate: "2026-01-01T00:00:00Z", phase: "CONSTRUCTION", plannedLoadMw: "5" }).success, true);
  assert.equal(s.rampStepCreateSchema.safeParse({ propertyId: "p", effectiveDate: "2026-01-01T00:00:00Z", phase: "BUILDING", plannedLoadMw: 5 }).success, false);
});

test("contracts accept any resource type; assets parse the microgrid flag from forms", () => {
  const c = g.ppaCreateSchema.parse({ name: "SMR", seller: "X", contractedMw: 300, termYears: 20, resourceType: "NUCLEAR", firmCapacityMw: "280" });
  assert.equal(c.resourceType, "NUCLEAR");
  assert.equal(c.contractType, "PPA");
  assert.equal(c.firmCapacityMw, 280);
  assert.equal(g.ppaCreateSchema.parse({ name: "G", seller: "X", contractedMw: 1, termYears: 1 }).resourceType, "GEOTHERMAL");
  assert.equal(g.assetCreateSchema.parse({ name: "T", type: "GAS_TURBINE", microgrid: "false" }).microgrid, false);
  assert.equal(g.assetCreateSchema.parse({ name: "T", type: "GAS_TURBINE", microgrid: true }).microgrid, true);
});

test("readings accept water discharge", () => {
  const r = g.readingCreateSchema.parse({ propertyId: "p", recordedAt: "2026-01-01T00:00:00Z", waterDischargedGallons: "290" });
  assert.equal(r.waterDischargedGallons, 290);
});

test("water volumes in litres or m³ are normalized to gallons with provenance", () => {
  const base = { propertyId: "p", recordedAt: "2026-01-01T00:00:00Z" };
  const { rows } = g.validateReadingsBody({ readings: [
    { ...base, waterConsumedGallons: 3785.411784, waterUnit: "L" },
    { ...base, waterConsumedGallons: 1, waterUnit: "m3" },
    { ...base, waterConsumedGallons: 10 },
  ] });
  assert.equal(rows[0].waterConsumedGallons, 1000);
  assert.deepEqual(rows[0].metadata.provenance, { waterInputUnit: "L", factorToGallons: 1 / 3.785411784 });
  assert.equal(Math.round(rows[1].waterConsumedGallons * 1000) / 1000, 264.172);
  assert.equal(rows[2].waterConsumedGallons, 10);
  assert.equal(rows[2].metadata.provenance.waterInputUnit, "gal");
  assert.equal("waterUnit" in rows[0], false);
});

test("storage change may be negative; other water fields may not", () => {
  const base = { propertyId: "p", recordedAt: "2026-01-01T00:00:00Z" };
  assert.equal(g.readingCreateSchema.safeParse({ ...base, waterStorageChangeGallons: -50 }).success, true);
  assert.equal(g.readingCreateSchema.safeParse({ ...base, waterReclaimedImportedGallons: -50 }).success, false);
});

test("readings accept a meterId; contracts accept an evidence reference", () => {
  const r = g.readingCreateSchema.parse({ propertyId: "p", recordedAt: "2026-01-01T00:00:00Z", meterId: "m1", facilityEnergyKwh: 1 });
  assert.equal(r.meterId, "m1");
  assert.equal(g.ppaCreateSchema.parse({ name: "A", seller: "B", contractedMw: 1, termYears: 1, evidenceReference: "PSC Docket 24-123" }).evidenceReference, "PSC Docket 24-123");
});
