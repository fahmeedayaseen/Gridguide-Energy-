# GridGuide Geothermal Energy & Water Module

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

- `GET /api/enterprise/geothermal/dashboard`
- `GET|POST /api/enterprise/geothermal/assets`
- `GET|POST /api/enterprise/geothermal/ppas`
- `GET|POST /api/enterprise/geothermal/readings`

POST requests require an enterprise Manager or Admin role. The readings endpoint accepts either one reading or a `readings` array of up to 500 records, allowing meter, DCIM, BMS, or utility integrations to ingest data.

## Deployment

1. Back up the target database and test the migration in staging.
2. Configure the existing production environment variables.
3. Install dependencies with `npm install`.
4. Apply migrations with `npx prisma migrate deploy`.
5. Build with `npm run build` and deploy through the normal GridGuide release process.

The migration is `prisma/migrations/20260924_enterprise_geothermal_energy_water/migration.sql`.

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

## Change log

**2026-10-07: Recycled Water Share**
- Kept the formula recycled ÷ (withdrawn + recycled) × 100 and renamed the metric "Recycled Water Share (%)". API field renamed from `efficiency.waterReusePct` to `efficiency.recycledWaterSharePct` (no other code read the old field).
- Dashboard "Measured performance" card now shows Recycled Water Share (%), or "No data" when no water volumes were reported.
- Reading form label changed to "New water withdrawn gal (excl. recycled)" so manual entries follow the definition above.
- Corrected the WUE unit in this document to liters per IT kWh, matching the code.
- Added tests for the 33.3% example, the zero-denominator case and the 100% upper bound. Run with `npm run test:geothermal`.
- PPA cards now label the estimate "Estimated contract value" instead of "Estimated term revenue", because for an enterprise buying power under a PPA the amount is a cost. Display text only; the API fields are unchanged.
