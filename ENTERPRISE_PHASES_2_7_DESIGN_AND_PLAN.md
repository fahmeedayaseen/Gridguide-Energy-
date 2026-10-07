# Enterprise Platform — Design Confirmation & Implementation Plan (Phases 2–7)

**Status: All 10 decisions from the review pass are answered and folded
in below (marked "DECISION CONFIRMED" at each point they apply). One
smaller item, surfaced while folding these in and not among the original
10, remains open — see the summary at the end. Ready for implementation
on Phases 2–4 and 6–7; Phase 5's frontend work specifically should wait
on that one remaining item.**

This supersedes the shorter scoping document from the previous pass —
that one identified *what* the phases are; this one is the detailed *how*,
grounded in direct inspection of the current codebase (not assumption),
covering schema, endpoints, frontend, permissions, billing, migration,
testing, and risk for each phase.

Where something was a genuine decision rather than an implementation
detail, it's marked **DECISION CONFIRMED** with the answer received, so
the reasoning stays visible rather than the decision silently
disappearing into the plan text.

---

## PART 1 — Design Confirmation

### 1.1 Cross-cutting findings that affect every phase below

**No Stripe subscription has ever been created for an `EnterpriseOrg`.**
`createSubscription({customerId, priceId, trialDays})` already exists in
`lib/stripe.js` and works — but nothing calls it for an enterprise org.
`POST /api/enterprise/billing-portal` only creates a Stripe *customer* and
opens the hosted portal for managing whatever gets set up there manually.
Phase 2 needs to actually call this existing helper for the first time in
this context, not build new Stripe plumbing from scratch.

**The permission-check helper that already exists for "organization roles"
cannot be reused.** `requireOrganizationRole()` in `lib/enterprise.js`
queries `prisma.organizationMember` — the model marked deprecated in the
architecture decision. It has zero connection to `EnterpriseTeamMember` or
`EnterpriseOrg`. Phase 5 needs a new, parallel permission helper built
against the correct model; there is no existing code to extend.

**Naming collision: two unrelated concepts are both called "ENTERPRISE."**
A homeowner's *personal* plan tier enum (`Plan`: `FREE | PRO | ENTERPRISE`)
and an `EnterpriseOrg`'s own top subscription tier (`ENTERPRISE_PLANS`:
`BUSINESS | PROFESSIONAL | ENTERPRISE`) both have a value literally named
`ENTERPRISE`, with no relationship to each other. A homeowner on the
personal "Enterprise" plan has nothing to do with a GridGuide Business org.

**DECISION CONFIRMED — both renamed, per direction received:**
- Homeowner `Plan` enum: `FREE | PRO | ENTERPRISE` → `HOMEOWNER_FREE |
  HOMEOWNER_PLUS | HOMEOWNER_PREMIUM`.
- `EnterpriseOrg`'s own tiers: `BUSINESS | PROFESSIONAL | ENTERPRISE` →
  `ENTERPRISE_BASIC | ENTERPRISE_PRO | ENTERPRISE_SCALE`.

**Verified before finalizing this:** `Installer.plan` and `Seller.plan`
use their own separate `InstallerPlan`/`SellerPlan` enums — neither
shares the `Plan` enum with `User`, so this rename has no effect on
installer or seller pricing. `Plan` is used in exactly two places:
`User.plan` (the real target) and `Organization.plan` (the deprecated,
zero-consumer model from the architecture decision) — the deprecated
model's default value changes semantically but nothing reads it, so this
is a no-consequence touch, not a real migration risk.

**Migration mechanics — homeowner side (real Postgres enum):**
`ALTER TYPE "Plan" RENAME VALUE 'FREE' TO 'HOMEOWNER_FREE'` (and the two
others) — supported since Postgres 10, but every place in the codebase
that compares against the literal old strings needs to change in the
*same* deploy, not before or after, since a mismatched window would
silently mis-gate plan features. An initial grep found 1 backend file
and 0 direct frontend matches for this specific comparison pattern — that
count should be treated as a starting point for implementation, not a
final audit; string comparisons can take forms a single grep pattern
won't catch (zod enums, Stripe webhook plan-mapping, membership checkout
price lookups). A full audit is a required step of Phase 2 implementation,
not assumed complete from this planning pass.

**Migration mechanics — enterprise side (plain String field, no enum):**
`EnterpriseOrg.plan` is a free-text `String`, not tied to a Postgres enum
— renaming its conventional values is an application-level change (update
the `ENTERPRISE_PLANS` frontend constant, any Stripe price-ID env var
names that encode the old tier names, and the couple of existing rows if
any orgs have already been provisioned with the old value strings — a
one-time data update, not a schema migration).

**All other sections in this plan below have been updated to use the new
names — flagging here so a reader doesn't need to mentally substitute.**

**No test framework exists in this project** (`package.json` has no test
script; no Jest/Vitest/Playwright dependency). Every phase's "testing plan"
below is a manual verification checklist plus the static-analysis tooling
already used throughout this engagement (Prisma relation integrity check,
full `.js` syntax sweep, brace/paren balance on the frontend monolith,
duplicate-declaration scan) — not automated test execution. Flagging this
plainly rather than implying a stronger guarantee than what's achievable
here.

### 1.2 Security / privacy / permissions concerns identified per phase

| Phase | Concern | Severity |
|---|---|---|
| 2 | Sponsorship changes a homeowner's billing without a purchase action *from* the homeowner. Needs an explicit homeowner-visible notice ("your plan is now sponsored by X") — silent plan changes on someone else's account are a real trust issue even when the change is beneficial (free upgrade). | Medium |
| 3 | Invitation-driven account creation means an Enterprise can cause a `User` row to exist for someone who never initiated contact with GridGuide. Needs rate limiting on invite sends (email-bombing risk) and a clear unsubscribe/decline path that doesn't require creating an account just to say no. | Medium |
| 4 | If an installer is added to an enterprise's network without requiring installer consent, an enterprise could misrepresent an affiliation. This is why Phase 4 (below) recommends requiring installer acceptance, not just admin approval. | Medium-High if consent is skipped |
| 5 | `EnterpriseTeamMember`'s role strings (`Owner/Admin/Manager/Viewer`) are currently **decorative only** — verified zero permission checks reference them anywhere in the Enterprise Portal's routes today. If Phase 5 gives team members real logins without also building real per-role authorization, every team member would have full owner-equivalent access regardless of their labeled role. | High if overlooked |
| 6 | Annual billing with proration touches real money calculations; a bug here directly causes billing disputes. Needs a staging-equivalent verification pass against Stripe's test mode before any production toggle. | Medium |
| 7 | A unified audit log that includes billing and referral data is itself sensitive (reveals commission structures, personal referral chains). Needs its own access scope — this should not be broadly readable by every admin role if fine-grained admin roles exist; confirm whether they do before assuming. | Medium |

### 1.3 Scalability notes
- Phase 2's per-seat subscription model should use Stripe subscription
  *items* (quantity-based), not one subscription per sponsored homeowner —
  the latter would not scale past a handful of sponsored seats per org
  operationally (N Stripe subscriptions to reconcile instead of 1).
- Phase 7's audit trail, if built as approach (a) (single write-through
  table), needs an index strategy from day one (`orgId`, `actorUserId`,
  `createdAt`, `actionType` at minimum) — audit tables grow unbounded and
  are exactly the kind of table that becomes an unindexed-query problem
  months after launch if not planned for now.

---

## PART 2 — Detailed Implementation Plans

---

## Phase 2: Enterprise-Sponsored Homeowner Subscriptions

### Schema
```prisma
model EnterpriseSponsorship {
  id          String    @id @default(cuid())
  orgId       String
  userId      String    @unique  // one active sponsorship per homeowner at a time
  plan        String    // "HOMEOWNER_PLUS" | "HOMEOWNER_PREMIUM" (the sponsored tier)
  status      String    @default("ACTIVE") // ACTIVE | PAUSED | ENDED
  startedAt   DateTime  @default(now())
  endedAt     DateTime?
  gracePeriodEndsAt DateTime? // if set, homeowner keeps sponsored plan until this date after ENDED

  org  EnterpriseOrg @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@index([status])
}
```
`EnterpriseOrg` gains: `sponsoredSeatLimit Int @default(0)`,
`sponsorshipStripeSubscriptionId String?`,
`sponsorshipStripeItemId String?` (the specific quantity-based line item
tracking seat count).

**DECISION CONFIRMED: `User.plan` is never overwritten by sponsorship.**
Effective plan is computed at read time as the max of the homeowner's own
`User.plan` and any active `EnterpriseSponsorship.plan`, using an explicit
rank order (not string comparison, which wouldn't sort correctly):
```js
const PLAN_RANK = { HOMEOWNER_FREE: 0, HOMEOWNER_PLUS: 1, HOMEOWNER_PREMIUM: 2 };
function getEffectivePlan(user, activeSponsorship) {
  if (!activeSponsorship) return user.plan;
  return PLAN_RANK[activeSponsorship.plan] > PLAN_RANK[user.plan] ? activeSponsorship.plan : user.plan;
}
```
This is correct but means **every existing plan-gated feature that reads
`user.plan` directly needs to switch to calling this helper instead** —
a real retrofit across whatever routes/components currently gate on
`user.plan`, sized similarly in spirit to (though smaller than) Phase 5's
permission retrofit. This needs its own audit pass during Phase 2
implementation to enumerate every such call site before assuming the
helper alone is sufficient — introducing the helper without migrating
existing call sites would leave sponsorship silently non-functional
everywhere except wherever the helper happens to get called.

### Backend endpoints
- `POST /api/enterprise/sponsorships` — enterprise admin sponsors a
  homeowner: body `{userId, plan}`. Validates seat limit not exceeded,
  creates the `EnterpriseSponsorship` row, updates the Stripe subscription
  item quantity (+1), sends the homeowner a notice email/notification.
- `DELETE /api/enterprise/sponsorships/[id]` — ends a sponsorship,
  decrements the Stripe item quantity, sets `gracePeriodEndsAt`.
- `GET /api/enterprise/sponsorships` — list for the org's Sponsored
  Homeowners UI, with seat usage vs. `sponsoredSeatLimit`.
- `POST /api/enterprise/billing/create-subscription` — **new**, the actual
  first call to the existing `createSubscription()` helper for an
  enterprise org; creates the base org subscription plus the seat-quantity
  item at $0 quantity initially.
- Cron addition to `lib/cron.js`: a daily job to actually end sponsorships
  whose `gracePeriodEndsAt` has passed and revert the homeowner's
  effective plan.

### Frontend
- Enterprise Portal: new "Sponsored Homeowners" panel (likely a new tab or
  a section within Billing) — search/add by email (reusing the same
  email-lookup pattern as Phase 1's device link, for consistency), list
  with remove action, seat usage bar.
- Homeowner Dashboard: a small, honest notice wherever plan/billing is
  shown ("Your Pro plan is sponsored by Acme HOA") — this is the
  transparency measure for the trust concern flagged in Part 1.
- Admin Portal: sponsorship-driven MRR shown as a distinct line from
  direct consumer MRR in whatever revenue reporting view is appropriate.

### Permission model
- Only `EnterpriseOrg.ownerUserId` can create/end sponsorships until Phase
  5 defines real team-member roles — do not build a permission check
  against `EnterpriseTeamMember.role` here, since Part 1 confirmed those
  roles are decorative today; that would create a false sense of access
  control.

### Stripe/billing changes
1. Create the org's base subscription (`createSubscription`) at
   provisioning time if not already present — retroactively needed for
   any org already provisioned by the Phase 1 admin-approval flow, since
   that flow (built previously) never created one.
2. Add a quantity-based subscription item for sponsored seats.
3. Every add/remove sponsorship call updates that item's quantity via
   Stripe's subscription-item update API, which handles proration
   automatically if `proration_behavior` is set correctly — needs an
   explicit choice of `create_prorations` vs. `none` (recommend
   `create_prorations` for correctness, confirm no objection).

### Migration strategy
- New table, additive only — no existing data to migrate.
- Backfill task: any `EnterpriseOrg` provisioned before this phase ships
  needs its base Stripe subscription created retroactively (one-time
  script, not part of normal request traffic).

### Testing/rollout plan (manual, per Part 1's constraint)
1. Verify seat-limit enforcement rejects sponsorship past
   `sponsoredSeatLimit` (expect `403`).
2. Verify Stripe test-mode subscription item quantity actually changes on
   add/remove (check via Stripe dashboard test data, not just a `200 OK`).
3. Verify a homeowner's effective plan reflects sponsorship immediately
   via the `getEffectivePlan()` rank comparison confirmed above.
4. Verify the grace-period cron job actually reverts plan access on the
   correct date, not before or after.
5. Static verification: relation-integrity check, full syntax sweep,
   frontend balance check — as run throughout this engagement.

### Risks/dependencies
- **Depends on Phase 3** for a non-throwaway way to establish the
  homeowner-org relationship being sponsored (see the sequencing note in
  the previous planning document) — this plan does not resolve that
  ordering question, it restates it as a live dependency.
- Retroactive subscription creation for already-provisioned orgs is a
  real one-time operational step, not just code — needs to be run once
  Phase 2 ships, not forgotten as a "someone will get to it" item.

---

## Phase 3: Enterprise Homeowner Invitation Flow

### Schema
```prisma
model EnterpriseHomeownerInvite {
  id                    String    @id @default(cuid())
  orgId                 String
  email                 String
  invitedByUserId       String
  invitedViaInstallerId String?   // set if sent on the enterprise's behalf by an approved installer
  status                String    @default("PENDING") // PENDING | ACCEPTED | DECLINED | EXPIRED
  token                 String    @unique
  createdAt             DateTime  @default(now())
  expiresAt             DateTime
  respondedAt           DateTime?

  org       EnterpriseOrg @relation(fields: [orgId], references: [id], onDelete: Cascade)
  installer Installer?    @relation(fields: [invitedViaInstallerId], references: [id], onDelete: SetNull)

  @@index([orgId])
  @@index([email])
  @@index([status])
}
```

### Backend endpoints
- `POST /api/enterprise/homeowner-invites` — body `{email, installerId?}`.
  Rate-limited per org (security concern from Part 1 — recommend reusing
  the existing `rateLimit()` helper already used by
  `forgot-password`, same pattern).
- `GET /api/enterprise/homeowner-invites` — list, for the enterprise's
  own tracking view.
- `GET /api/invites/homeowner/[token]` — public, unauthenticated lookup
  to render the accept/decline landing page correctly before login.
- `POST /api/invites/homeowner/[token]/accept` — body varies: if no
  account exists, `{name, password}`; if one exists and the requester is
  already logged in, no body needed. Creates the `User` if needed
  (mirroring the placeholder-then-email-setup-link pattern already built
  for enterprise org owners in Phase 1 of the prior work), establishes
  the org relationship, and — if `invitedViaInstallerId` is set — creates
  a real `InstallerReferral` row so the existing referral/commission
  system picks it up with no parallel logic.
- `POST /api/invites/homeowner/[token]/decline` — no account creation
  required to decline (the privacy/consent concern from Part 1).

### Frontend
- New public page `app/invite/homeowner/[token]/page.jsx` (following the
  same standalone-page pattern as `app/reset-password/page.jsx` built
  previously) — shows the inviting org's name, an accept/decline choice,
  and the account-creation form only if needed.
- Enterprise Portal: "Invite Homeowner" action, likely on the Properties
  or a new Homeowners tab, with a sent-invites status list.
- **Explicitly does not** auto-trigger Phase 1's device-link flow on
  acceptance — offers it as a clearly separate next action, preserving
  Phase 1's already-approved consent-first design rather than blending
  the two flows into one implicit approval.

### Permission model
- Sending invites: org owner only, until Phase 5 defines team roles (same
  reasoning as Phase 2).
- Accepting: must match the invited email exactly if the acceptor is
  already logged in as a different user — reject with a clear error
  rather than silently attaching the org relationship to the wrong account.

### Stripe/billing changes
None directly — this phase only establishes the relationship. Sponsorship
billing, if applicable, is a separate action via Phase 2's endpoints,
not bundled into acceptance automatically.

### Migration strategy
New table, additive only.

### Testing/rollout plan
1. Verify rate limiting actually blocks a burst of invites from one org.
2. Verify decline requires no account creation.
3. Verify accepting with an email that already has an account links
   correctly without touching their existing password.
4. Verify `invitedViaInstallerId` correctly produces a real
   `InstallerReferral` row, and that row correctly flows into the
   *existing*, already-verified installer commission calculation from
   earlier in this engagement — this is the single highest-value
   regression check in this phase, since it's the integration point with
   infrastructure that already works correctly today.
5. Static verification suite, as above.

### Risks/dependencies
- **Feeds Phase 2** as its dependency (see above).
- **DECISION CONFIRMED: Phase 3 ships first, without installer
  attribution.** `invitedViaInstallerId` should be omitted from the UI and
  the field left unused (schema stays as designed, just not exercised)
  until Phase 4 ships. **This creates a required Phase 4 sub-task, not
  optional cleanup:** once `EnterpriseInstallerNetwork` exists, Phase 4's
  implementation must include re-enabling `invitedViaInstallerId` in the
  Phase 3 invitation UI *and* adding server-side validation that the named
  installer has an `ADMIN_APPROVED` network row with the inviting org —
  without that validation, any installer ID could be passed once the
  field is re-exposed, defeating the consent/approval model Phase 4 exists
  to enforce.

---

## Phase 4: Enterprise-Installer Network + Admin Approval

### Schema
```prisma
model EnterpriseInstallerNetwork {
  id                   String    @id @default(cuid())
  orgId                String
  installerId          String
  status               String    @default("INVITED")
  // INVITED -> INSTALLER_ACCEPTED -> ADMIN_APPROVED (active)
  //         -> INSTALLER_DECLINED / ADMIN_REJECTED / REMOVED
  invitedAt            DateTime  @default(now())
  installerRespondedAt DateTime?
  adminApprovedByUserId String?
  adminApprovedAt      DateTime?

  org       EnterpriseOrg @relation(fields: [orgId], references: [id], onDelete: Cascade)
  installer Installer     @relation(fields: [installerId], references: [id], onDelete: Cascade)

  @@unique([orgId, installerId])
  @@index([orgId])
  @@index([installerId])
  @@index([status])
}
```

**DECISION CONFIRMED: installer consent is required.** The state machine
below (`INVITED -> INSTALLER_ACCEPTED -> ADMIN_APPROVED`) is final, not
tentative — matches the consent-first precedent from Phase 1.

**DECISION CONFIRMED: an approved relationship grants invitation/referral
eligibility only.** Specifically: the installer becomes a valid
`invitedViaInstallerId` value for Phase 3's invitation flow (per the
Phase 3 retrofit task noted above). **Enterprise data visibility for
installers is explicitly out of scope, not merely deferred** — an
approved network relationship does not grant an installer any read
access to the org's properties, homeowners, or reports. If that's wanted
later, it needs its own separate design pass with its own data-exposure
review, not an incremental addition to this phase's permission model.

### Backend endpoints
- `POST /api/enterprise/installer-network` — body `{installerId}`,
  creates `INVITED` status, notifies the installer.
- `POST /api/installers/network-invites/[id]/respond` — installer
  accepts/declines, body `{action}`.
- `POST /api/admin/enterprise-installer-network/[id]/approve` — platform
  admin final approval, only reachable once status is
  `INSTALLER_ACCEPTED`.
- `GET /api/enterprise/installer-network` and
  `GET /api/admin/enterprise-installer-network` (pending-approval queue,
  mirroring the pattern already built for `enterprise-requests`).

### Frontend
- Enterprise Portal: "Installer Network" panel — invite by installer
  search/email, status list.
- Installer Portal: a pending-invites section (new; no equivalent exists
  today) with accept/decline.
- Admin Portal: approval queue, same visual pattern as the existing
  Enterprise Business Accounts pending-requests tab built previously.

### Permission model
Same org-owner-only constraint as Phases 2–3 until Phase 5.

### Stripe/billing changes
None — this relationship carries no billing implication as scoped.

### Migration strategy
New table, additive only.

### Testing/rollout plan
1. Verify an installer cannot be force-added without their acceptance
   (per the consent decision above) — attempt admin approval while status
   is still `INVITED` and confirm it's rejected.
2. Verify the `@@unique([orgId, installerId])` constraint actually
   prevents duplicate relationship rows.
3. Static verification suite.

### Risks/dependencies
- Feeds Phase 3's installer-attribution feature (see Phase 3 risks —
  Phase 4 must include the retrofit task noted there).
- Enterprise data visibility for installers has been explicitly rejected
  as part of this phase's scope (see decision above) — if a future
  request reopens this, treat it as a new design pass with its own
  data-exposure review, not a quick addition to `EnterpriseInstallerNetwork`.

---

## Phase 5: Admin Invitation/Creation of Enterprise Administrators

**DECISION CONFIRMED: Phase 5 is the large version** — multiple real
logins per `EnterpriseOrg`, with actually-enforced permissions, not just
an admin shortcut around the request-access queue. Everything below
applies as written; the full route-by-route retrofit is required scope
for this phase, not an optional stretch goal.

### Schema
`EnterpriseTeamMember` needs a real account link:
```prisma
model EnterpriseTeamMember {
  // ...existing fields...
  userId String?  // NEW — set once the invited person accepts and has a real account
  user   User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
}
```
Plus an invite-token mechanism mirroring Phase 3's pattern:
`inviteToken String? @unique`, `inviteExpiresAt DateTime?`.

### Backend endpoints
- `POST /api/enterprise/team/[id]/resend-invite` or extend the existing
  team creation endpoint to always generate a token + send a real invite
  email (today it creates the roster row but — confirmed in the prior
  pass — the `sendTeamInvite` email exists and fires; what's missing is
  the *accept* side that turns it into a real login).
- `POST /api/invites/team/[token]/accept` — same account-creation-or-link
  pattern as Phase 3.
- **New authorization middleware**, e.g. `requireEnterpriseTeamRole(userId,
  orgId, allowedRoles)` — the real replacement for the non-reusable
  `requireOrganizationRole()` identified in Part 1. Every existing
  Enterprise Portal route that currently only checks
  `EnterpriseOrg.ownerUserId === auth.user.id` needs to be revisited to
  also accept an authorized team member — this touches every route built
  in the prior Enterprise Portal work (dashboard, properties, team,
  fleet, analytics, revenue, carbon, billing, api-keys, settings), not
  just new ones. **This is the largest single piece of retrofitting in
  the entire plan** — flagging its true size rather than understating it.

### Frontend
- Enterprise Portal Team tab: real "resend invite" / "revoke access"
  actions instead of just a roster display.
- Session restoration (`EnterpriseApp`) needs to also check "is this user
  an accepted team member of some org" in addition to the existing
  "is this user the owner" check.
- **Remaining open item, not among the 10 decisions already resolved —
  flagging rather than silently inferring an answer:** when a `Manager` or
  `Viewer` team member logs in, does the UI show the *same* dashboard with
  restricted sections hidden/disabled (recommended — consistent with the
  approved matrix, standard practice), or a materially different, reduced
  layout? The approved permission matrix defines *what* each role can do;
  it doesn't by itself specify how that's presented. Recommend the former
  as the default unless told otherwise, but not assuming silently given
  the standing instruction against unstated architectural choices.

### Permission model — APPROVED, final

`Owner` = full access including billing and team management. `Admin` =
full access except billing and removing the Owner. `Manager` = properties,
fleet, and device-link-approvals-view (not billing/team/settings).
`Viewer` = read-only everywhere. This matrix is confirmed and should be
implemented as written — no further sign-off needed on the roles
themselves. What still needs care during implementation: applying this
matrix consistently across every existing Enterprise Portal route (see
the retrofit note above), and the corresponding audit-log access scoping
in Phase 7, which reuses these same four roles (see Phase 7 below).

### Stripe/billing changes
None directly, though the "Admin can see billing, Manager cannot"
distinction above has to be enforced on the billing-portal endpoint too.

### Migration strategy
- `userId` added as nullable — existing `EnterpriseTeamMember` rows
  (roster entries with no login) remain valid with `userId = null` until
  each is individually re-invited through the new accept flow. No forced
  backfill; this can roll out gradually per-org.

### Testing/rollout plan
1. Verify a `Viewer`-role team member genuinely cannot write anything
   (attempt a PATCH against every retrofitted route, expect 403).
2. Verify billing-portal access is genuinely restricted to Owner (and
   Admin, if that's the agreed matrix).
3. Verify accepting a team invite never allows escalation beyond the
   role the invite was sent with.
4. Full retrofit regression pass across every existing Enterprise Portal
   route — this is the phase most likely to introduce a silent regression
   in already-working features, given its size.

### Risks/dependencies
This is the highest-risk phase in the entire plan due to the retrofit
scope. Recommend it be scheduled with the most buffer, and recommend
splitting its rollout: ship the schema + invite/accept flow first (net
new, low risk), then retrofit permission checks route-by-route as a
separate, reviewable pass rather than one large change.

---

## Phase 6: Annual Enterprise Billing

**Hard dependency on Phase 2's subscription-creation work already being
live** — there is nothing to set a billing cycle on until that exists.

### Schema
`EnterpriseOrg.billingCycle String @default("MONTHLY")` (`MONTHLY |
ANNUAL`).

### Backend endpoints
- `POST /api/enterprise/billing/change-cycle` — body `{cycle}`, swaps the
  Stripe subscription's price to the matching annual/monthly Price ID for
  the org's current plan tier, using Stripe's proration on the switch.

### Stripe/billing changes
Requires new annual Price IDs per `EnterpriseOrg` tier (`ENTERPRISE_BASIC`,
`ENTERPRISE_PRO`, `ENTERPRISE_SCALE`) — three new
`STRIPE_PRICE_ENTERPRISE_*_ANNUAL` env vars, following the existing
naming convention in `.env.example`.

**DECISION CONFIRMED: 15% annual discount.** Concrete annual prices
(15% off monthly × 12, rounded to a clean number):
| Tier | Monthly | Monthly × 12 | Annual (15% off) |
|---|---|---|---|
| `ENTERPRISE_BASIC` | $99 | $1,188 | **$1,010/yr** |
| `ENTERPRISE_PRO` | $299 | $3,588 | **$3,050/yr** |
| `ENTERPRISE_SCALE` | $999 | $11,988 | **$10,190/yr** |
Exact rounding (to the dollar vs. a marketing-friendly round number like
$999/yr for Scale) is a final pricing/marketing call, not something this
plan should silently pick — the table above is the precise 15%-off
figures for reference at implementation time.

### Frontend
Billing tab: cycle toggle, showing the effective monthly-equivalent price
for comparison.

### Migration strategy
Additive field, defaults existing orgs to `MONTHLY` (their current
implicit behavior) — no behavior change for anyone who doesn't opt in.

### Testing/rollout plan
1. Verify switching cycles prorates correctly in Stripe test mode —
   check actual invoice line items, not just that the API call succeeded.
2. Verify downgrading from annual back to monthly mid-cycle behaves
   sensibly (no double-charge, no silently-lost paid time).

### Risks/dependencies
Sequencing: must ship after Phase 2, not in parallel — building against a
subscription model that doesn't exist yet isn't testable.

---

## Phase 7: Unified Audit Trail

**DECISION CONFIRMED: single write-through table.** Schema below is final,
not conditional.

### Schema
```prisma
model PlatformAuditLog {
  id           String   @id @default(cuid())
  actorUserId  String?  // null for system/cron-initiated actions
  actorRole    String?  // snapshot of the actor's role at the time
  action       String   // e.g. "ENTERPRISE_ORG_PROVISIONED", "DEVICE_LINK_APPROVED"
  targetType   String?  // e.g. "EnterpriseOrg", "Device", "InstallerReferral"
  targetId     String?
  orgId        String?  // set when the action is enterprise-scoped, for org-level filtering
  category     String   // "BILLING" | "ASSIGNMENT" | "REFERRAL" | "TEAM" | "VPP" | "OTHER" — drives the role-scoped access filter below
  metadata     Json?
  createdAt    DateTime @default(now())

  @@index([orgId])
  @@index([actorUserId])
  @@index([createdAt])
  @@index([action])
  @@index([category])
}
```
Added `category` beyond the original sketch specifically to make the
now-confirmed role-scoped access (below) a real filter rather than a
vague "limited logs" promise.

### Backend changes
Every write path identified as in-scope needs an added log call:
`EnterpriseAuditLog` writes (already exist, ~8 call sites from prior
work) migrate to also/instead write here; new call sites needed at:
installer referral status transitions (currently untimestamped beyond
`referredAt` — a real gap noted in the prior plan, meaning some history
genuinely cannot be reconstructed retroactively), VPP payout processing
(partially covered by existing `VppPayout`/`InstallerVppEarning` records,
but not in this log's format), and billing events (subscription created/
changed/cancelled webhooks).

**Access endpoint:** `GET /api/admin/audit-log` with filters
(`orgId`, `actorUserId`, `action`, `category`, date range).

**DECISION CONFIRMED: audit log access is role-scoped**, reusing the same
four Enterprise Portal roles approved in Phase 5 — this endpoint serves
both platform admins and enterprise-side team members viewing their own
org's log, gated by the same matrix rather than a separate one:
- `Owner`, `Admin` → full log, all categories.
- `Manager` → `category` restricted to `ASSIGNMENT` and `VPP` only
  (device-link and revenue-split activity relevant to day-to-day property
  operations) — explicitly excludes `BILLING`, `TEAM`, and `REFERRAL`
  categories, which involve financial and personnel information outside
  a Manager's approved access per the Phase 5 matrix.
- `Viewer` → no audit log access at all, consistent with Phase 5's
  read-only-everywhere definition (the audit log itself is not part of
  "everywhere" a Viewer can read).
This is why `category` was added to the schema above — without it, "Manager
sees limited logs" has no concrete filter to actually implement against.

### Frontend
Admin Portal: new "Audit Log" view — searchable/filterable timeline.

### Migration strategy
New table. **Historical backfill is not possible** for data that was
never logged in the first place (the installer referral status-transition
gap above) — the audit trail is complete only from its ship date forward.
This should be stated plainly to whoever relies on it for compliance
purposes, not left implicit.

### Testing/rollout plan
1. Verify every identified write path actually produces a log row —
   this is the phase most likely to have "silently missing" coverage,
   since a forgotten call site fails quietly (nothing errors, the log
   is just incomplete).
2. Verify the access-scope decision above is actually enforced.

### Risks/dependencies
Largest ongoing-maintenance risk in the plan: every *future* feature
touching enterprise/installer/billing/VPP data needs to remember to write
here too, or the trail silently degrades again. Recommend a lightweight
convention (e.g., a shared `logAudit()` helper that's easy to reach for)
rather than relying on each future PR remembering independently.

---

## Summary: decisions confirmed

All 10 decisions from the previous pass have been answered and folded
into Part 2 above:

1. **Naming** — both renamed: homeowner `Plan` → `HOMEOWNER_FREE /
   HOMEOWNER_PLUS / HOMEOWNER_PREMIUM`; `EnterpriseOrg` tiers →
   `ENTERPRISE_BASIC / ENTERPRISE_PRO / ENTERPRISE_SCALE`. Verified this
   only affects `User.plan` and the deprecated, zero-consumer
   `Organization.plan` — no conflict with `InstallerPlan`/`SellerPlan`,
   which are separate enums.
2. **Phase 2** — `User.plan` never overwritten; effective plan computed
   at read time via `getEffectivePlan()`, rank-based, detailed above.
3. **Phase 3** — ships first without installer attribution; Phase 4 has
   an explicit, required sub-task to re-enable and validate it.
4. **Phase 4** — installer consent required; state machine confirmed.
5. **Phase 4** — approved relationships grant invitation eligibility
   only; enterprise data visibility for installers explicitly rejected,
   not deferred.
6. **Phase 5** — large version confirmed: real multi-login, enforced
   permissions, full existing-route retrofit required.
7. **Phase 5** — Owner/Admin/Manager/Viewer matrix approved as final.
8. **Phase 6** — 15% annual discount confirmed; concrete per-tier prices
   calculated above.
9. **Phase 7** — single write-through `PlatformAuditLog` table confirmed.
10. **Phase 7** — audit access role-scoped using the same Phase 5 roles;
    concrete category-based filter defined above (`category` field added
    to the schema specifically to make this implementable, not aspirational).

### One smaller item surfaced while folding these in, not among the original 10 — flagged rather than silently assumed
Whether restricted-role team members see the same dashboard with
sections hidden, or a materially different layout (Phase 5, frontend
section). Recommended default: same dashboard, gated visibility. Not
proceeding on this as settled without confirmation, per the standing
instruction against silent architectural choices.

### Still required at implementation time, not resolved by this planning pass
The `User.plan` literal-string audit (Phase 2) and the `PlatformAuditLog`
write-path enumeration (Phase 7) were each estimated, not exhaustively
catalogued, during planning — both are named as required first steps of
their respective phases' implementation, not optional follow-up.

Implementation can proceed on Phases 2–4 and 6–7 as planned. Phase 5's
one remaining item above should be confirmed before its frontend work
specifically begins — it doesn't block starting Phase 5's schema/backend
work, which is unaffected by the answer.
