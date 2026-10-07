# Enterprise / Multi-Tenant Architecture Decision

**Status: NEEDS YOUR DECISION — nothing in this document has been acted on.**
No code, schema, or routes have been changed as a result of this investigation.
This exists so the choice below can be made deliberately, before API keys are
added and live testing begins.

---

## The two systems, side by side

| | **System A** | **System B** |
|---|---|---|
| Core model | `EnterpriseOrg` | `Organization` |
| Related models | `EnterpriseProperty`, `EnterpriseTeamMember`, `EnterpriseAuditLog` | `OrganizationMember`, `Property` (shared with individual homeowners), `VppProgram`, `RevenueTransaction` |
| Ownership model | Single `ownerUserId` — one person owns the org | `OrganizationMember` join table — real multi-user roles (`OWNER/ADMIN/MANAGER/MEMBER/VIEWER`), each with `status` (so you can deactivate a member without deleting them) |
| Permission checks | None beyond "do you own this org" | `requireOrganizationRole()` — real role-gated access per action |
| Plan limit enforcement | Hardcoded limits object in each route (`{BUSINESS:5, PROFESSIONAL:25, ENTERPRISE:Infinity}`) | Integrated with the platform's actual membership/plan system (`assertLimit`, `assertFeature` from `lib/memberships.js`) |
| Fee/revenue integration | None | `RevenueTransaction.organizationId`, `VppProgram.organizationId`, `calculateGridGuideFee()` — organizations can participate in real platform-wide revenue and VPP accounting |
| Entity scope | Enterprise portal only | Broader taxonomy: `OrganizationType` = `HOMEOWNER \| PROPERTY_MANAGER \| COMMERCIAL \| UTILITY \| PARTNER` — designed as general-purpose multi-tenancy, not enterprise-specific |
| When it was built | `prisma/migrations/20260630_enterprise_portal/migration.sql` — a specific, recent, deliberately-named migration | No migration file exists for it at all — it's part of the original `prisma db push` baseline, meaning it predates the migration history entirely (built earlier in the project) |
| Frontend consumers today | `EntDash`, `EntProperties`, `EntUsers` — **wired up and working** (fixed this session) | **Zero.** No frontend code anywhere calls `/api/enterprise/organizations`, `/api/enterprise/organizations/[id]/members`, or even the generic `/api/properties` endpoint that already supports organization-scoped properties |
| Seed data | None found | None found |

## What this means

**System A (`EnterpriseOrg`) is simpler, narrower, and it's what's actually
live today** — I wired the real dashboard, properties, and team tabs to it
this session, and it works.

**System B (`Organization`) is architecturally more capable and appears to
have been the original, more ambitious multi-tenant vision** — real
role-based permissions, and it's the model that `RevenueTransaction` and
`VppProgram` already point to. It looks like when the Enterprise Portal
actually needed to ship (the June 30 migration), a simpler parallel system
was built instead of finishing the integration with this older, more
complex one — a reasonable shipping decision at the time, but it left two
tenant systems in the schema.

**Your instinct is sound, with one real tradeoff to go in with eyes open:**
keeping `EnterpriseOrg` (System A) is the lower-risk choice because it's
the one with working, tested UI behind it today. The cost of that choice is
that Enterprise orgs will **not** participate in the platform's unified
revenue/VPP accounting (`RevenueTransaction`, `VppProgram`) unless that
integration is separately rebuilt on top of `EnterpriseOrg` later, since
those two models only relate to `Organization`, not `EnterpriseOrg`. That's
not a hidden defect — it's the direct consequence of which model you keep,
worth stating plainly rather than discovering later.

---

## 1. Primary organization/enterprise model

**Recommendation: `EnterpriseOrg`**, matching your instinct — it's the
system with real, working, tested frontend behind it as of this session.

## 2. Tables/models being kept

- `EnterpriseOrg`
- `EnterpriseProperty`
- `EnterpriseTeamMember`
- `EnterpriseAuditLog`
- `EnterpriseRequest` (the lead-capture table `POST /api/enterprise/request-access` writes to — separate from both systems, unaffected either way)

## 3. Routes that should use the primary model

Already correctly using `EnterpriseOrg` — no change needed:
- `GET /api/enterprise/dashboard`
- `GET`/`POST /api/enterprise/properties`
- `GET`/`POST /api/enterprise/team`
- `POST /api/enterprise/request-access`
- `GET /api/enterprise/contact`

## 4. Routes/models being deprecated (recommended, not yet done)

- `GET`/`POST /api/enterprise/organizations`
- `GET`/`POST /api/enterprise/organizations/[id]/members`
- `Organization`, `OrganizationMember` models — **do not drop yet** (see
  §5). Mark deprecated in code comments and stop building any new feature
  against them.

**Not recommended for deprecation, needs a separate decision:**
`Property`, `VppProgram`, `RevenueTransaction`, and `lib/enterprise.js`'s
helper functions (`requireOrganizationRole`, `checkPropertyLimit`,
`calculateGridGuideFee`, `enterpriseSummary`) are more entangled — `Property`
in particular is also used by `GET`/`POST /api/properties`, which is itself
unused by any frontend today but isn't specific to the Enterprise
duplication question. Recommend a separate, later review of whether
`/api/properties` and `Property` have a different intended purpose
(e.g. a future general property-management feature for all account types)
before deciding their fate — don't fold that decision into this one.

## 5. Migration needed for existing data

- **In this repository's reference environment: none found.** No seed
  script writes to `Organization`, `OrganizationMember`, or any
  Organization-linked `Property`/`VppProgram`/`RevenueTransaction` row, and
  there's no migration file for these tables at all (they're part of the
  original `db push` baseline). I have no visibility into a live production
  database, though — **run this before deciding anything is migration-free:**
  ```sql
  SELECT count(*) FROM "Organization";
  SELECT count(*) FROM "OrganizationMember";
  SELECT count(*) FROM "Property" WHERE "organizationId" IS NOT NULL;
  ```
  If any of these return non-zero in your actual production database, this
  section needs to be redone before deprecating anything — those rows
  represent real tenants/data that would need a real migration path onto
  `EnterpriseOrg`, not a "mark deprecated and move on."
- If those counts are genuinely zero, no data migration is needed — this
  becomes purely a "stop building on the unused system, deprecate its
  routes" decision with no data risk.

---

## Suggested next step

Once you've confirmed the row counts above are zero (or decided how to
handle them if not), the concrete follow-up work — deprecating the two
routes, adding deprecation comments to the `Organization`/`OrganizationMember`
models in `schema.prisma`, and documenting the decision in
`WHERE_IS_EVERYTHING.md` — is small and low-risk. I haven't done any of it
yet, per your instruction; say the word when you want it done.
