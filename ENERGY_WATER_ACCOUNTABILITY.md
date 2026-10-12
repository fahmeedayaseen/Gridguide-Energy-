# GridGuide Data-Center Energy & Water Accountability

**Positioning:** a vendor-neutral data-center energy and water accountability platform, not a geothermal product. It tracks every resource serving a site — geothermal, solar, wind, hydro, nuclear, gas, storage and grid supply — in one portfolio. Geothermal stays a featured resource category (★ in the UI, its own overview card).

The Enterprise portal tab is **Energy & Water**. The canonical API is `/api/enterprise/energy-water/*`; the original `/api/enterprise/geothermal/*` routes still work as aliases.

## What it manages

| Need | Where | How |
|---|---|---|
| Multiple generation contracts serving one data center | Contracts tab | Contracts carry `resourceType` (GEOTHERMAL, SOLAR, WIND, HYDRO, NUCLEAR, GAS, DIESEL, STORAGE, GRID_MIX, OTHER) and `contractType` (PPA, virtual PPA, utility tariff, sleeved, capacity, reserve, tolling, behind-the-meter). Any number per site. |
| Private-microgrid resources and contracted reserve margins | Assets + Load & Reserve tabs | Assets can be flagged `microgrid` with accredited `firmCapacityKw`; contracts carry `firmCapacityMw`. Each site has a `requiredReserveMarginPct`. Reserve margin = (firm capacity − peak load) ÷ peak load, now and at full build-out, with the extra firm MW needed. Only firm values a user entered count; resources without one are listed as "not counted". |
| Load ramp from construction through peak operation | Load & Reserve tab | Ramp steps (`effectiveDate`, phase, planned average MW, planned peak MW). Monthly planned vs actual load; actual = site-level facility kWh ÷ hours covered by readings, with data coverage shown and low-coverage months flagged. |
| Permits, regulatory milestones, transmission approvals | Permits tab | Category (permit, filing, rate case, interconnection, transmission, environmental, water rights, zoning), agency, docket, status, due/filed/decided/expiry dates, link. Overdue, due-in-90-days and expiring-approval counts. |
| Customer-versus-ratepayer cost allocation | Costs tab | Each cost item: total, customer share, ratepayer share, other share, basis (tariff, contract, commission order, settlement, estimate), status and source reference. Shares can't exceed the total; unallocated remainder is shown. |
| Actual delivery vs contracted MW and MWh | Contracts (record) + Portfolio (compare) | Deliveries per settlement period (`deliveredMwh`, optional peak MW and curtailment), entered by hand or posted by a settlement feed. Compared against contracted MWh for the same periods (stated annual MWh, else MW × hours × capacity factor within the delivery window). Unreported periods are never counted as shortfall. |
| Direct cooling water and upstream generation water | Water tab | Direct = on-site readings. Upstream = delivered MWh × a user-entered water intensity (gal/MWh) per contract, plus grid MWh × the site's grid intensity; each figure carries its source. No default factors are filled in; energy without an intensity is reported as "not counted". |
| Renewable, geothermal, nuclear and gas in one portfolio | Portfolio tab | Mix by resource: contracts, contracted MW, firm MW, microgrid MW, delivered MWh; carbon-free share of delivered energy, with unknown-mix energy shown separately rather than assumed. |

### Verified water claims

Verified water claims require **withdrawal, consumption, discharge and reclaimed-water** measurements. For the selected period a claim is:

- **VERIFIED** — every reading that reports any water figure reports all four (`waterWithdrawnGallons`, `waterConsumedGallons`, `waterDischargedGallons`, `waterRecycledGallons`), and the balance closes: new water withdrawn ≈ consumed + discharged, within 10%.
- **INCOMPLETE** — some water readings are missing one of the four (the missing fields are named).
- **UNBALANCED** — all four are present but the balance doesn't close.
- **NO_DATA** — no water readings.

Until a period is VERIFIED, WUE, recycled-water share and water saved vs. baseline are labelled **UNVERIFIED** in the UI. Reclaimed/recycled water is reused on site and tracked separately; it is not part of withdrawal.

### New API routes (Oct 12, 2026)

| Route | Methods | Who |
|---|---|---|
| `/api/enterprise/energy-water/portfolio?days=` or `?from=&to=` (+ `propertyId`) | GET | Viewer+ |
| `/api/enterprise/energy-water/contracts` · `/:id` | GET POST · PATCH DELETE | GET also API key (no pricing) · writes Manager+ |
| `/api/enterprise/energy-water/deliveries` · `/:id` | GET POST · PATCH DELETE | GET/POST also API key (upsert by externalId) · Manager+ |
| `/api/enterprise/energy-water/ramp-steps` · `/:id` | GET POST · PATCH DELETE | Viewer+ · Manager+ |
| `/api/enterprise/energy-water/milestones` · `/:id` | GET POST · PATCH DELETE | Viewer+ · Manager+ |
| `/api/enterprise/energy-water/cost-allocations` · `/:id` | GET POST · PATCH DELETE | Viewer+ · Manager+ |
| `/api/enterprise/energy-water/properties` · `/:id` | GET · PATCH (reserve requirement, grid water intensity + source) | Viewer+/API key · Manager+ |
| `/api/enterprise/energy-water/{dashboard,assets,readings}` | as before | aliases of the geothermal routes |

Calculations live in `lib/energy-water-portfolio.mjs` (pure, unit-tested); validation in `lib/energy-water-schemas.js`. Migration: `prisma/migrations/20261012_energy_water_accountability`.

---

## Original module notes (geothermal, readings, CSV, API keys)


This release adds an enterprise module for tracking geothermal generation, data-center energy use, cooling water, emissions avoidance, and geothermal power-purchase agreements (PPAs).

## Included functionality

- Enterprise **Energy & Water** dashboard with overview, assets, contracts, and readings views.
- Geothermal and data-center asset registry.
- PPA tracking for contracted capacity, annual energy, term, counterparty, and optional price.
- Batch or single sustainability readings for electricity, IT load, cooling load, water withdrawal/consumption/recycling, baseline water consumption, and avoided carbon emissions.
- Derived PUE, WUE, geothermal coverage, cooling-energy share, Recycled Water Share (%), and water-savings metrics.
- PPA value estimates only when pricing is supplied; confidential or missing pricing remains unknown.
- Enterprise role checks, validation, and audit logging on API changes.
- Empty states instead of fabricated demo measurements.

## API routes

| Route | Methods | Who |
|---|---|---|
| `/api/enterprise/geothermal/dashboard?days=` or `?from=&to=` (+ `&propertyId=`) | GET | Viewer+ |
| `/api/enterprise/geothermal/properties` | GET | Viewer+ or API key |
| `/api/enterprise/geothermal/assets` | GET · POST | GET: Viewer+ or API key · POST: Manager+ |
| `/api/enterprise/geothermal/assets/:id` | PATCH · DELETE | Manager+ |
| `/api/enterprise/geothermal/ppas` | GET · POST | Viewer+ · Manager+ |
| `/api/enterprise/geothermal/ppas/:id` | PATCH · DELETE | Manager+ |
| `/api/enterprise/geothermal/readings` | GET · POST | GET: Viewer+ or API key · POST: Manager+ or API key |
| `/api/enterprise/geothermal/readings/:id` | PATCH · DELETE | Manager+ |

- **Readings POST** accepts one reading or `{ "readings": [...] }` (max 500). Validation is per row; errors name the failing row numbers.
- **Readings GET** supports `propertyId`, `assetId`, `source`, `from`, `to`, `limit` (≤ 500) and cursor paging (`nextCursor`).
- **Upserts:** a reading with an `externalId` is upserted on (org, source, externalId), so a retried or corrected meter value updates the stored reading instead of duplicating it. Integrations should always send one.
- **Deleting an asset** that has readings or PPAs is refused (409); set its status to `RETIRED` instead.
- Every create, edit and delete is audit-logged.

### Integrations (API keys)

Meters, BMS and DCIM systems authenticate with an Enterprise API key (created by an Admin under **API Keys**; requires the org's API access to be enabled):

```
Authorization: Bearer gg_live_...      (or  X-API-Key: gg_live_...)
```

Keys can only read properties/assets/readings and add readings — `middleware.js` rejects a key on any other route, and keys never act with Admin/Owner rights. Readings sent with a key default to `source: "API"`. Limit: 120 requests per minute per key.

### CSV import

**Import & API → Import Readings from CSV** in the portal. Columns: `propertyId` or `property` (name), optional `assetId` or `asset` (name), `recordedAt`, `intervalMinutes`, any of the measurement fields, optional `externalId`. Blank cells mean "not measured". Rows are checked in the browser first (problems listed by line number), then uploaded in batches of 500. Each row gets a stable `externalId` derived from property, asset and time, so re-importing a corrected file updates rather than duplicates.

## Deployment

1. Back up the target database and test the migration in staging.
2. Configure the existing production environment variables.
3. Install dependencies with `npm install`.
4. Apply migrations with `npx prisma migrate deploy`.
5. Build with `npm run build` and deploy through the normal GridGuide release process.

Migrations: the module's tables are in the `0_init` baseline; `prisma/migrations/20261011_geothermal_complete/migration.sql` makes measurements nullable, adds `updatedAt` to readings and indexes API-key hashes.

## Metric definitions

- **PUE:** total facility electricity / IT electricity.
- **WUE:** water consumed / IT electricity, reported in liters per IT kWh (gallons are converted at 3.785411784 L/gal).
- **Geothermal coverage:** geothermal electricity / total facility electricity.
- **Cooling share:** cooling electricity / total facility electricity.
- **Recycled Water Share (%):** recycled water / (water withdrawn + recycled water) × 100. This is the percentage of total water supplied to the facility that came from recycled water. Example: 100 gal withdrawn + 50 gal recycled = 33.3%. The result cannot exceed 100%. API field: `efficiency.recycledWaterSharePct`.
- **Water saved:** baseline water consumed minus actual water consumed, floored at zero.

### Water volume definitions

- **Water withdrawn** (`waterWithdrawnGallons`) is newly sourced water only (municipal, groundwater, surface or other new supply). It must exclude recycled water so recycled volumes are not counted twice.
- **Water recycled** (`waterRecycledGallons`) is water treated or reclaimed on site and returned to use.
- Both volumes on a reading cover that reading's interval (`recordedAt` + `intervalMinutes`), and dashboard totals sum both over the same selected period, so the two values in the ratio always describe the same reporting period. Integrations must send both volumes for the same interval in the same record.

Ratios are returned as unknown when their denominator is absent or zero. This avoids presenting missing operational data as a measured zero. The dashboard shows an unknown Recycled Water Share as "No data".

### Missing is not zero

Every measurement on a reading is optional and stored as `NULL` when not reported. A total is "No data" when no reading in the period reported it, and each ratio only uses readings that reported **both** of its inputs — a reading with facility energy but no IT energy doesn't distort PUE. The dashboard aggregates in Postgres (one row per UTC day) rather than loading every reading. Readings saved before 2026-10-11 stored blank form fields as `0`; those can't be distinguished automatically and can be corrected in the Readings tab.

## Change log

**2026-10-11: Module completion**
- Edit and delete for assets, PPAs and readings (API + UI); asset delete blocked while readings/PPAs reference it.
- Enterprise API-key authentication for integrations on the readings, assets and properties routes.
- CSV import with in-browser validation, batching and re-import without duplicates.
- Nullable measurements: blank is "No data", never 0; ratios use paired readings only.
- Dashboard: property filter, custom date range, aggregation in Postgres.
- Readings list with filters and paging; upsert by externalId; per-row validation errors.
- Asset form gains status, thermal capacity and commercial-operation date; PPA form gains utility, status, escalation, approval, dates and notes.

**2026-10-07: Recycled Water Share**
- Kept the formula recycled ÷ (withdrawn + recycled) × 100 and renamed the metric "Recycled Water Share (%)". API field renamed from `efficiency.waterReusePct` to `efficiency.recycledWaterSharePct` (no other code read the old field).
- Dashboard "Measured performance" card now shows Recycled Water Share (%), or "No data" when no water volumes were reported.
- Reading form label changed to "New water withdrawn gal (excl. recycled)" so manual entries follow the definition above.
- Corrected the WUE unit in this document to liters per IT kWh, matching the code.
- Added tests for the 33.3% example, the zero-denominator case and the 100% upper bound. Run with `npm run test:geothermal`.
- PPA cards now label the estimate "Estimated contract value" instead of "Estimated term revenue", because for an enterprise buying power under a PPA the amount is a cost. Display text only; the API fields are unchanged.
