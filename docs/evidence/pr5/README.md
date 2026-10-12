# PR #5 acceptance evidence

Response to *GridGuide PR #5 — Data Center Energy & Water Developer Handoff* (review dated 12 October 2026).
Everything here was produced from the commits below; the raw outputs are in this folder.

**Interim wording (as approved in the handoff):** *All targeted PR #5 tests pass, but full application build verification remains pending until the GitHub billing restriction is resolved.*

## Commits

| PR | Branch | Head commit |
|---|---|---|
| #3 P0 security & money paths | `p0-security-money-paths` | `abf2127436b7f1c9700030ac8faaaacc3d303299` |
| #4 Geothermal module completion (base: #3) | `geothermal-complete` | `d6f64ddcfe086f82bb8c4ae0361e12177c1e69f5` |
| #5 Energy & Water accountability (base: #4) | `energy-water-portfolio` | code at `5fc79f4e419e2189c7610086e56fa9ab44c519a1`; the commit that adds this folder contains documentation and evidence files only |

Why the earlier review saw "the earlier geothermal-focused implementation": the review package was taken from `main`. None of #3–#5 is merged yet, so `main` still has the original code. Review the branches above (or the PR diffs) instead.

## Environment

See `environment.txt`: Node 22.22.0 · Ubuntu 24.04.5 · PostgreSQL 16.15 · Chromium 141 (Playwright 1.56) · esbuild 0.28.2. The project's npm dependencies **could not be installed** in this environment (npm registry blocked by the sandbox's network policy); only `zod` was available, which is why some suites below defer to CI.

## Handoff decisions — implemented

| Handoff item | Status | Where |
|---|---|---|
| **A. Tiered balance:** VERIFIED ≤ 5%, REVIEW > 5–10%, UNVERIFIED > 10% or missing input; variance = \|in − out\| ÷ max(in, 1) | Done | `lib/geothermal-metrics.mjs` (`waterClaimStatus`, `WATER_VERIFIED_MAX_PCT`, `WATER_REVIEW_MAX_PCT`) |
| Storage change in the balance when material | Done: optional signed `waterStorageChangeGallons`; `STORAGE_CHANGE_NOT_REPORTED` reason when absent | same |
| **B.** Separate potable withdrawal, imported reclaimed water and on-site recycling | Done: `waterWithdrawnGallons` (potable), `waterReclaimedImportedGallons` (new, external input), `waterRecycledGallons` (on-site loop, never an input) | schema + migration `20261013_water_balance_v2_meters` |
| Balance: potable + reclaimed imported ≈ consumed + discharged (+ storage) | Done | `waterClaimStatus` |
| **C.** Meter level, parent, coverage %, interval, effective dates, settlement priority | Done: `EnterpriseMeter` | schema, `lib/energy-water-meters.mjs`, `/api/enterprise/energy-water/meters` |
| No overlapping coverage summed; deterministic de-duplication; preferred settlement meter | Done: overlap rejected on save; only top-level MAIN/SETTLEMENT summed; SUB/CHECK never added; duplicate readings per meter+timestamp collapsed in SQL (latest update wins); preferred settlement meter used alone (priority, then id) | `validateMeter`, `loadMetersAt`, `siteMonthlyLoad`, portfolio load SQL |
| Status object: `verification_status`, `missing_measurements`, `balance_variance_pct`, `verification_reasons`, `formula_version` | Done (plus `calculated_at`, `thresholds`, `balance`, reading counts) | `metrics.waterClaim` on dashboard and portfolio responses |
| WUE, recycled share and water saved inherit the period's status | Done: `waterEvidenceStatus`; UI tags REVIEW / UNVERIFIED | metrics + screens |
| Aggregations expose the least-trusted contributor | Done: per-site claims, combined with `combineWaterClaims`; `siteWaterClaims` returned | metrics + portfolio |
| Provenance: formula version, inputs, timestamp, source | Done: `calculation` block on portfolio (formula versions, `calculatedAt`, input counts); `formula_version` on water and reserve results; reading `metadata.provenance` records the input unit | portfolio route, schemas |
| Units normalized | Done: water accepted as `gal`, `L` or `m3` (`waterUnit`), stored in gallons, original unit kept | `normalizeWaterUnits` |
| Contract evidence | Done: `evidenceReference` on contracts (shown, and flagged when missing) | schema, UI |
| Reserve margin: list missing inputs | Done: `missingInputs`, `calculable` | `reserveMargin` |
| Legacy geothermal URLs | Kept as aliases; tested | `tests/backward-compat.test.mjs` |

## Explicit acceptance tests (handoff §5)

| Acceptance test | Test(s) |
|---|---|
| Missing withdrawal / consumption / discharge / reclaimed classification → UNVERIFIED naming the field | `geothermal-metrics`: "missing … yields UNVERIFIED and names the field" (×4) |
| 4.9% verifies, 5.1% review, 10.1% unverified | `geothermal-metrics`: "4.9% variance verifies, 5.1% needs review, 10.1% is unverified" |
| On-site recycled not added to withdrawal; imported reclaimed included | `geothermal-metrics`: "onsite recycled water is NOT an input; imported reclaimed water IS" |
| Two non-overlapping main meters aggregate; overlapping parent/sub rejected or de-duplicated | `energy-water-meters`: "two non-overlapping main meters aggregate", "overlapping main-meter coverage is rejected", "parent/sub-meter coverage is de-duplicated", plus the SQL de-dup check in `postgres-migration-roundtrip`-adjacent run (see below) |
| Missing firm capacity / water rate / delivery stays unknown | `energy-water-portfolio`: delivery "nothing reported ≠ zero", reserve "null without firm capacity", "names every missing input", upstream "only uses entered intensities" |
| Carbon-free share and upstream water use delivered energy, correct units, disclosed rates | `energy-water-portfolio`: resource mix and upstream water tests; UI shows each rate's cited source |

## Results

### Unit and calculation tests — `unit-tests.tap.txt`

`node --import ./tests/helpers/register-alias.mjs --test tests/*.test.mjs` on a clean export of `5fc79f4`: **103 tests — 91 pass, 3 fail, 9 skipped.**

| Test file | Pass | Fail | Skip | Notes |
|---|---|---|---|---|
| `tests/auth-tokens.test.mjs` | 0 | 1 | 0 | Cannot find package 'jsonwebtoken' — PR #3 test; runs in CI after npm ci |
| `tests/backward-compat.test.mjs` | 19 | 0 | 0 |  |
| `tests/device-type.test.mjs` | 0 | 1 | 0 | Cannot find package 'axios' — PR #3 test; runs in CI after npm ci |
| `tests/energy-water-meter-routes.test.mjs` | 0 | 0 | 1 | needs Prisma client (runs in CI) |
| `tests/energy-water-meters.test.mjs` | 9 | 0 | 0 |  |
| `tests/energy-water-portfolio.test.mjs` | 13 | 0 | 0 |  |
| `tests/energy-water-schemas.test.mjs` | 10 | 0 | 0 |  |
| `tests/field-encryption.test.mjs` | 5 | 0 | 0 |  |
| `tests/geothermal-metrics.test.mjs` | 25 | 0 | 0 |  |
| `tests/geothermal-schemas.test.mjs` | 7 | 0 | 0 |  |
| `tests/installer-fees.test.mjs` | 0 | 1 | 0 | Cannot find package '@prisma/client' — PR #3 test; runs in CI after npm ci |
| `tests/secrets.test.mjs` | 3 | 0 | 0 |  |
| `tests/wallet-money-paths.db.test.mjs` | 0 | 0 | 8 | needs DATABASE_URL + Prisma client (runs in CI) |

The 3 failures are PR #3 files that can't load here because their npm packages aren't installed; the 9 skipped need a database and the Prisma client. All of them run in CI (`npm ci` + Postgres service).

### SQL ↔ in-memory parity — `sql-vs-js-parity.txt`

The dashboard/portfolio aggregate in PostgreSQL (one row per day × site). 13 randomized datasets (2 queries each, session time zone America/Indiana/Indianapolis) produced the same metrics, daily trend, per-site water claims and least-trusted combined claim as the in-memory calculation (to within a cent of float rounding). All three statuses were exercised through SQL (VERIFIED, REVIEW, UNVERIFIED).

### PostgreSQL migrations — `postgres-migration-roundtrip.txt`

`tests/db/migration-roundtrip.sh` on PostgreSQL 16.15: the four Oct 2026 migrations apply → smoke checks (new tables/columns writable, NULL stays NULL, signed storage, unique delivery key, FK cascade/set-null, expected indexes) → rollbacks in reverse order (`prisma/rollbacks/`) → re-apply → smoke checks again. **PASS.**
Limitation: until the Prisma-generated `0_init` baseline is committed (needs npm or CI), pre-baseline tables are created from minimal stand-ins plus the archived 20260924 migration. CI's `prisma migrate deploy` + drift check supersedes this.

### Browser checks — `browser-suite-*.txt`, `screenshots/`

The real `EntGeothermal` component, compiled from `5fc79f4`, rendered in headless Chromium against an in-browser mock API that uses the real calculation libraries:

- Suite 1 (module basics, from #4): **28 / 28 pass**
- Suite 2 (accountability + review changes): **38 / 38 pass**, including VERIFIED → REVIEW → UNVERIFIED transitions on the Water tab, missing-measurement messaging, preferred-settlement-meter rejection, meter selection and signed storage on readings
- Zero page or console errors in both suites. Screenshots for every tab, missing-input states, the review state and mobile width are in `screenshots/`.

Limitation: the API is mocked in these runs; the API routes themselves have not been exercised against a live database (needs Prisma client — CI).

## Not yet verified (release blockers)

| Item | Why | Next action |
|---|---|---|
| `npm ci`, `prisma validate` / `generate`, `next build` | npm registry unreachable here; GitHub Actions locked | Clear billing, re-run CI on each PR |
| Full migration chain from `0_init` + drift check | `0_init` must be generated by Prisma | Runs automatically (`generate-baseline.yml`) or `scripts/generate-baseline.sh` |
| API routes against a real database (incl. `wallet-money-paths.db.test.mjs`) | Prisma client unavailable here | CI Postgres service |
| PR #3 tests needing jsonwebtoken / axios / Prisma | packages unavailable here | CI |

## GitHub billing restriction

- **What:** every GitHub Actions job on `fahmeedayaseen/Gridguide-Energy-` is refused before it starts. Check-run annotation (e.g. run `114898182166` on the PR #5 head): *"The job was not started because your account is locked due to a billing issue."*
- **Affected workflows:** `CI` (`.github/workflows/ci.yml`: install, Prisma validate, migrate deploy on empty Postgres, drift check, tests, production build) and `Generate Prisma baseline` (`.github/workflows/generate-baseline.yml`).
- **Owner:** the GitHub account that owns the repository (`fahmeedayaseen`, GridGuide).
- **Remediation:** GitHub → Settings → Billing and plans: resolve the failed payment or spending limit for Actions. Then re-run the failed checks on PRs #3, #4 and #5 (Actions tab → "Re-run all jobs"), in that order.
- **Untested until then:** everything in the table above.

## Developer response checklist

- [x] PR links and exact commit SHAs for #3, #4 and #5 — above.
- [x] Tiered 5% / 10% balance policy implemented — no variance from the handoff. Boundaries are inclusive (5.0% → VERIFIED, 10.0% → REVIEW).
- [x] Separate fields for imported reclaimed water and on-site recycled water.
- [x] Multi-meter hierarchy, coverage, overlap protection and settlement-meter rules. Meter changes during a month: the month is split at each meter's effective dates and the intervals are added; the mid-month configuration is used only when splitting is impossible, and that load is marked ESTIMATED with the assumption disclosed (`load-ramp-v3-interval-split`, see `load-interval-split.txt`).
- [x] Migration, calculation-test, browser-test and PostgreSQL evidence attached (this folder).
- [x] GitHub billing restriction explained, with owner and next action.
- [ ] Final product, engineering and release approvals — **pending**. Product should also confirm the water definitions above become the standard for "verified" claims.

## Reproduce

```bash
git checkout 5fc79f4e419e2189c7610086e56fa9ab44c519a1
npm ci                                     # or link node_modules/zod only, as here
npm test                                   # unit + calculation + compat tests
PGURL=postgresql://user:pass@localhost:5432/postgres tests/db/migration-roundtrip.sh
```
Browser harnesses and the SQL parity script are in `harness/` (see its README).
