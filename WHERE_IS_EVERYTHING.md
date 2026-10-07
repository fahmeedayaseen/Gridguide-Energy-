# Where is the frontend / backend / database?

This is a **single Next.js (App Router) project**. Next.js does not separate
"frontend" and "backend" into different top-level folders or different
apps — pages/UI and API routes both live under `app/`, and share the same
`package.json`, build, and deploy step. Splitting them into physically
separate `frontend/` and `backend/` folders would break routing, the shared
`@/lib` import alias, and the single-command deploy. So instead, here's
exactly where each part lives inside this one project:

## Frontend (UI, pages, everything the browser renders)

| What | Where |
|---|---|
| Main multi-portal single-file app (marketing sites, homeowner dashboard, portal switcher) | `app/platform/GridGuidePlatform.jsx` |
| Route wrapper that mounts it (Homeowner Portal: marketing site → login/signup → dashboard) | `app/platform/page.jsx`, `app/platform/layout.jsx` |
| Admin Portal (real login, real data) | `app/admin/page.jsx` → renders `AdminApp` |
| Installer Portal (real login, real data) | `app/portals/installer/page.jsx` → renders `InstallerApp` |
| Seller Portal (real login, real data) | `app/portals/seller/page.jsx` → renders `SellerApp` |
| Enterprise Portal (real login/request-access; dashboard data still local — see below) | `app/portals/enterprise/page.jsx` → renders `EnterpriseApp` |

**All five portals from the original audit plan now have real authentication
and a dedicated route.** As of 2026-07-03, there is exactly one
implementation of each. Earlier versions of this project had a second,
separate, stale copy of Admin/Installer/Seller in
`app/components/{Admin,Installer,Seller}Portal.jsx` with fake
`@example.com` demo data and, in Installer's case, login components that
didn't exist anywhere and would have crashed on render — those files (plus
the fully-unused `DualSites.jsx`) have been deleted. Separately, the
Homeowner Portal's login/signup were checking against a hardcoded-empty
in-memory array (`DB_users = []`) that reset on every page load — real
signups were never actually saved anywhere. All five portals' login/signup
now call the real `/api/auth/*` endpoints. `AdminApp`/`InstallerApp`/
`SellerApp`/`EnterpriseApp` are plain React components, named-exported from
the same file the Homeowner Portal is built from — no separate frontend
build step, no separate repo.

**Known remaining gap, flagged not hidden:** connecting *auth* to the real
backend was this pass's job. Several dashboard tabs still read from
placeholder local data instead of fetching their own real data:
- Homeowner: `DashOverview`, `DashUtility`, `DashVPP`, `DashInstallers` read
  safe empty-state defaults (via `homeownerDefaults()`) rather than real
  device/utility/VPP data — `DashRewards` and `DashPayments` already fetch
  real data correctly and are the reference pattern to follow.
- Enterprise: the entire dashboard (`EntDash`, `EntProperties`, `EntFleet`,
  etc.) reads and writes to a local `let ENT_ORG = {...}` object — "adding a
  property" doesn't call the real `POST /api/enterprise/properties` that
  already exists, it just mutates local state that resets on refresh.

See `DEPLOYMENT_CHECKLIST.md` for the full list.

## Backend (API, business logic, auth)

| What | Where |
|---|---|
| All REST API routes (~104 routes: auth, billing, VPP, marketplace, wallet, referrals, etc.) | `app/api/**/route.js` |
| Auth middleware (JWT verification, public-route allowlist) | `middleware.js` |
| Shared server logic (JWT, auth helpers, db client, Stripe, wallet, credits, geo, integrations, email/SMS, cron) | `lib/*.js` |
| Background jobs | `lib/cron.js` |
| Error monitoring | `lib/sentry.js`, `instrumentation.js` |

## Database

| What | Where |
|---|---|
| Schema (all models, relations, enums) | `prisma/schema.prisma` |
| Migration history (applied in order) | `prisma/migrations/*/migration.sql` |
| Seed scripts (dev data, VPP providers, geo/ZIP data) | `prisma/seed*.js` |
| Database design notes / no-fake-data policy | `database/*.md` |

## Running it

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL, JWT_SECRET, STRIPE keys, etc.
npx prisma migrate deploy      # apply database/prisma/migrations to your Postgres instance
npm run db:seed                # optional: seed dev data
npm run dev                    # frontend + backend both run from this one command, on :3000
```

See `README.md` for the fuller architecture diagram and `DEPLOY.md` for
production deployment notes.

## Recently fixed (this pass)

- **Portal unification** — `/admin`, `/portals/installer`, `/portals/seller`
  now render `AdminApp`/`InstallerApp`/`SellerApp` directly from
  `GridGuidePlatform.jsx` instead of three stale, fake-data forked files
  (now deleted). This also surfaced and fixed real broken auth: Admin's
  login was a hardcoded local check, Seller's login checked against a
  permanently-empty demo-accounts array (could never succeed), and
  Installer's login/register components were referenced but never defined
  anywhere (guaranteed crash on render). All three now use real
  `/api/auth/login`, `/api/auth/register`, and the role-specific profile
  endpoints (`/api/installers/register`, `/api/sellers/register`). See
  `DEPLOYMENT_CHECKLIST.md` for full detail.

- **`middleware.js`** — closed an auth bypass where several sensitive routes
  (installer leads/commissions/earnings/revenue, marketplace product
  mutation, admin geo-seeding) were reachable without a valid token because
  of broad prefix matching, and client-supplied identity headers weren't
  stripped on public routes.
- **`lib/jwt.js`** — `requireRole()` now correctly accepts multiple roles;
  previously `requireRole(request, "SELLER", "ADMIN")` silently dropped the
  second role. JWT secrets now fail fast at boot in production instead of
  silently falling back to a hardcoded dev value.
- **`lib/auth.js`** — removed `ADMIN` as a self-selectable role in the
  (unused but latent) `registerSchema`.
- **`prisma/schema.prisma`** — fixed two invalid relations that would have
  failed `prisma generate` before any build could even start:
  `Device` was missing the `enterprisePropertyId` column that its own
  migration already added to the database, and `VppEvent.enrollments` was
  never actually implemented anywhere and had no matching foreign key.
- **`app/api/vpp/events/[id]/dispatch/route.js`** — added; the frontend
  already called this endpoint but it didn't exist.

**Still open:** there is no baseline Prisma migration — only incremental
migrations starting `20260626_*`, implying the original schema was applied
via `prisma db push` rather than a migration. On a brand-new database,
`prisma migrate deploy` will fail. Run
`npx prisma migrate dev --create-only` against a dev database that's already
in sync with `schema.prisma` to capture a proper baseline before deploying
to a fresh environment.

## Addressed an external code review (2026-07-03, same day)

The utility connection flow was previously a fake `setTimeout` that always
"succeeded" regardless of input — now makes real calls end-to-end. This
also surfaced and fixed a missing OAuth callback (`GET
/api/utility/connect` built an authorization URL pointing at a callback
route that didn't exist — the flow could never complete), the identical gap
for thermostats (Ecobee/Nest), a `redis.getdel()` bug that doesn't exist on
either Redis implementation this codebase uses (would have thrown on every
OAuth callback), three endpoints that fabricated random "bill/usage/rate"
data when live calls failed instead of reporting unavailability, and a
missing `nanoid` dependency that would have broken the production build.
Full detail in `DEPLOYMENT_CHECKLIST.md`.


Implements the Utility Intelligence Module plan: nationwide utility
identification, connection routing, admin management, and an AI router —
built inside the existing database and geo-intelligence pipeline rather
than as a separate system, per that plan's own recommendation.

| Phase | What was built | Where |
|---|---|---|
| 1. Utilities master DB | Extended `UtilityTerritory` with connection-method support flags, program/rate eligibility flags, contact/portal links; added `UtilityProgram`, `UtilityIncentive`, `UtilityRatePlan` tables | `prisma/schema.prisma`, migration `20260701_utility_intelligence_module` |
| 2. Connection routing | Green Button → Arcadia → direct API → manual, with plain-language reasoning and fallback ordering; admin can pin a utility to a specific method | `lib/utility-routing.js` |
| 3. Admin management portal (backend) | Full CRUD for utilities, programs, incentives, rate plans; connection success/error monitoring | `app/api/admin/utilities/**` |
| 4. Load utility data | 20 utilities seeded across CA, TX, IN, IL (priority states) plus MI, MN, PA, VA, NC, GA, NY, FL, with real programs/incentives/rate plans | `prisma/seed-utilities.js` — run via `npm run db:seed:utilities` |
| 5. AI Utility Router | Public endpoint: utility + recommended connection method + VPP programs + rebates + net metering/TOU + estimated savings | `app/api/utilities/router` |

`lib/geo-intelligence.js` was rewired to prefer this new DB-backed data,
falling back to its old hardcoded `UTILITY_MASTER`/`STATE_INCENTIVES`
arrays only for utilities not yet seeded — so nothing broke, and coverage
grows as more utilities are added via the seed script or admin portal.
`POST /api/utility/accounts` (the actual connect flow) now logs a
`UtilityConnectionEvent` on every attempt, and its `connectionType` enum
was broadened — it was missing `ARCADIA` and `BILL_UPLOAD`, silently
blocking two of the four routing methods.

**Not done — explicitly out of scope this pass:** Phase 3's admin
*frontend* (a UI tab in the Admin Portal to manage utilities/programs/
incentives visually). The backend API is complete and ready for one; the
UI itself wasn't built. The connection-method flags seeded in
`prisma/seed-utilities.js` are a reasonable starting configuration, not
verified live integration status — confirm each utility's actual Green
Button / Arcadia / direct API support before relying on it for real
customer signups.
