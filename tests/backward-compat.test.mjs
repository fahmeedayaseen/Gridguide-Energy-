// Legacy /api/enterprise/geothermal/* links and existing clients keep working
// after the move to /api/enterprise/energy-water/*. Static checks (no DB or
// Next.js needed); CI additionally builds the app, which resolves every alias import.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");
const methodsOf = (src) => {
  const out = new Set();
  for (const m of src.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) out.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:const\s+)?\{\s*([^}]+)\}/g)) for (const n of m[1].split(",")) { const k = n.trim().split(/\s+as\s+/).pop(); if (/^(GET|POST|PUT|PATCH|DELETE)$/.test(k)) out.add(k); }
  for (const m of src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g)) out.add(m[1]);
  return [...out].sort();
};

// legacy path → [canonical alias path, methods the legacy route has always had]
const LEGACY = {
  "dashboard": ["dashboard", ["GET"]],
  "assets": ["assets", ["GET", "POST"]],
  "assets/[id]": ["assets/[id]", ["DELETE", "PATCH"]],
  "ppas": ["contracts", ["GET", "POST"]],
  "ppas/[id]": ["contracts/[id]", ["DELETE", "PATCH"]],
  "readings": ["readings", ["GET", "POST"]],
  "readings/[id]": ["readings/[id]", ["DELETE", "PATCH"]],
};

for (const [legacy, [alias, methods]] of Object.entries(LEGACY)) {
  test(`legacy /geothermal/${legacy} still exports ${methods.join(", ")}`, () => {
    const file = `app/api/enterprise/geothermal/${legacy}/route.js`;
    assert.ok(existsSync(root + file), `${file} missing`);
    assert.deepEqual(methodsOf(read(file)), methods);
  });
  test(`/energy-water/${alias} re-exports the same handlers as /geothermal/${legacy}`, () => {
    const src = read(`app/api/enterprise/energy-water/${alias}/route.js`);
    assert.ok(src.includes(`@/app/api/enterprise/geothermal/${legacy}/route.js`), "alias must import the legacy module itself, not a copy");
    assert.deepEqual(methodsOf(src), methods);
  });
}

test("legacy geothermal/properties route still exists", () => {
  assert.deepEqual(methodsOf(read("app/api/enterprise/geothermal/properties/route.js")), ["GET"]);
});

test("API keys keep working on legacy integration paths", () => {
  const mw = read("middleware.js");
  for (const p of ["/api/enterprise/geothermal/readings", "/api/enterprise/geothermal/assets", "/api/enterprise/geothermal/properties",
                   "/api/enterprise/energy-water/readings", "/api/enterprise/energy-water/deliveries"]) {
    assert.ok(mw.includes(`path: "${p}"`), `${p} missing from API_KEY_ROUTES`);
  }
});

test("existing response fields are preserved for old clients", () => {
  const ppas = read("app/api/enterprise/geothermal/ppas/route.js");
  assert.match(ppas, /ppas: contracts/, "GET /ppas must still return a `ppas` array");
  const dash = read("app/api/enterprise/geothermal/dashboard/route.js");
  for (const k of ["metrics", "portfolio", "properties", "assets", "ppas: ppasWithValue", "trend"]) assert.ok(dash.includes(k), `dashboard lost ${k}`);
});

test("old readings payloads (no new water fields, no meterId) still validate", async () => {
  let g;
  try { g = await import("../lib/geothermal-schemas.js"); } catch { return; } // zod unavailable outside CI
  const oldPayload = { propertyId: "p1", recordedAt: "2026-09-01T00:00:00Z", facilityEnergyKwh: 1200, itEnergyKwh: 1000,
    waterWithdrawnGallons: 800, waterConsumedGallons: 100, waterRecycledGallons: 200, source: "API", externalId: "m-1" };
  const { rows, errors } = g.validateReadingsBody({ readings: [oldPayload] });
  assert.deepEqual(errors, []);
  assert.equal(rows[0].waterWithdrawnGallons, 800);
});

test("the Enterprise nav keeps the existing tab id so saved links (?tab=geothermal) open the new screen", () => {
  const ui = read("app/platform/GridGuidePlatform.jsx");
  assert.ok(ui.includes('{id:"geothermal",') && ui.includes('case"geothermal":'));
});
