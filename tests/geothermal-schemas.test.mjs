// Run with: node --import ./tests/helpers/register-alias.mjs --test tests/geothermal-schemas.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const s = await import("../lib/geothermal-schemas.js");
const base = { propertyId: "p1", recordedAt: "2026-10-01T12:00:00.000Z" };

test("blank form fields become null, not zero", () => {
  const r = s.readingCreateSchema.parse({ ...base, facilityEnergyKwh: "120", waterConsumedGallons: "" });
  assert.equal(r.facilityEnergyKwh, 120);
  assert.equal(r.waterConsumedGallons, null);
  assert.equal(r.itEnergyKwh, undefined);
});

test("a reading needs at least one measurement", () => {
  assert.equal(s.readingCreateSchema.safeParse({ ...base }).success, false);
  assert.equal(s.readingCreateSchema.safeParse({ ...base, carbonAvoidedKg: 0 }).success, true);
});

test("rejects negative values, unknown fields and far-future timestamps", () => {
  assert.equal(s.readingCreateSchema.safeParse({ ...base, itEnergyKwh: -1 }).success, false);
  assert.equal(s.readingCreateSchema.safeParse({ ...base, itEnergyKwh: 1, orgId: "x" }).success, false);
  const future = new Date(Date.now() + 3 * 864e5).toISOString();
  assert.equal(s.readingCreateSchema.safeParse({ ...base, recordedAt: future, itEnergyKwh: 1 }).success, false);
});

test("batch validation reports the failing row numbers", () => {
  const { rows, errors } = s.validateReadingsBody({ readings: [
    { ...base, itEnergyKwh: 1 },
    { ...base },
    { ...base, itEnergyKwh: -5 },
  ] });
  assert.equal(rows, null);
  assert.deepEqual(errors.map((e) => e.row), [2, 3]);
});

test("batch limit is enforced", () => {
  const readings = Array.from({ length: s.MAX_READINGS_PER_REQUEST + 1 }, () => ({ ...base, itEnergyKwh: 1 }));
  assert.equal(s.validateReadingsBody({ readings }).rows, null);
});

test("PPA delivery window must not end before it starts", () => {
  const ppa = { name: "A", seller: "B", contractedMw: 5, termYears: 10 };
  assert.equal(s.ppaCreateSchema.safeParse({ ...ppa, deliveryStartAt: "2027-01-01T00:00:00Z", deliveryEndAt: "2026-01-01T00:00:00Z" }).success, false);
  assert.equal(s.ppaCreateSchema.safeParse({ ...ppa, deliveryStartAt: "2026-01-01T00:00:00Z", deliveryEndAt: "2027-01-01T00:00:00Z" }).success, true);
});

test("update schemas accept partial edits but not empty ones", () => {
  assert.equal(s.assetUpdateSchema.safeParse({ status: "RETIRED" }).success, true);
  assert.equal(s.assetUpdateSchema.safeParse({}).success, false);
  assert.equal(s.ppaUpdateSchema.safeParse({ pricePerMwh: "" }).data?.pricePerMwh, null);
  assert.equal(s.readingUpdateSchema.safeParse({ waterConsumedGallons: null }).success, true);
});
