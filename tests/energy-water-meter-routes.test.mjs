// Meter API validation schema (zod) — the hierarchy rules themselves are in energy-water-meters.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";

let routes;
try { routes = await import("../lib/energy-water-meter-routes.js"); } catch { routes = null; } // needs prisma client (CI)

test("meter create schema requires level, coverage bounds and an effective date", { skip: !routes }, () => {
  const ok = routes.meterCreateSchema.safeParse({ propertyId: "p", name: "Main", meterLevel: "MAIN", effectiveFrom: "2026-01-01T00:00:00Z" });
  assert.equal(ok.success, true);
  assert.equal(ok.data.coveragePct, 100);
  assert.equal(routes.meterCreateSchema.safeParse({ propertyId: "p", name: "X", meterLevel: "MAIN", coveragePct: 0, effectiveFrom: "2026-01-01T00:00:00Z" }).success, false);
  assert.equal(routes.meterCreateSchema.safeParse({ propertyId: "p", name: "X", meterLevel: "LEAF", effectiveFrom: "2026-01-01T00:00:00Z" }).success, false);
});
