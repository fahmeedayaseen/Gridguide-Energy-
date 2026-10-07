# Enterprise Platform — Phases 2–7 Implementation Plan

**Status: PLANNING ONLY. No code has been written against this document.**
Phase 1 (consent-first device assignment) is confirmed complete and
verified against the exact specified flow — see the bottom of this
document for that verification. Everything below is Phases 2–7, scoped
for review before any building starts.

Two things surfaced while writing this plan that affect it materially,
flagged up front rather than buried:

- **No Stripe subscription is ever actually created for an `EnterpriseOrg`
  today.** `POST /api/enterprise/billing-portal` creates a Stripe
  *customer* and hands off to Stripe's hosted billing portal — but nothing
  in this codebase ever calls `stripe.subscriptions.create()` for an
  enterprise org. Phases 2 and 6 both assume a subscription exists to
  sponsor seats against or bill annually — that foundation needs to be
  built first, inside Phase 2, not assumed.
- **`EnterpriseTeamMember` has no `userId` field.** It's a roster entry —
  name, email, role — not a login account. Today, exactly one person per
  org (`EnterpriseOrg.ownerUserId`) can ever actually log into the
  Enterprise Portal. Phase 5, as scoped, needs to decide whether it's
  fixing this (giving team members real accounts) or is narrower than
  that (see Phase 5 below).

---

## Phase 2: Enterprise-sponsored homeowner subscription logic

**Goal:** an Enterprise can pay for N homeowners' GridGuide plan access
instead of those homeowners paying individually.

**Schema:**
- New model `EnterpriseSponsorship`: `orgId`, `userId`, `plan` (the tier
  being sponsored), `status` (ACTIVE/PAUSED/ENDED), `startedAt`, `endedAt`.
  One row per sponsored homeowner, not a seat *count* on `EnterpriseOrg` —
  a row-per-relationship makes "who's sponsored and since when" a direct
  query instead of inferred from a counter.
- `EnterpriseOrg` needs `sponsoredSeatLimit` (how many homeowners they've
  paid for) so sponsorship additions can be capped and billed correctly.

**Billing — the real open problem:**
Since no subscription exists yet, this phase has to build subscription
creation itself: an Enterprise's Stripe subscription needs a
quantity-based (per-seat) line item that goes up or down as sponsorships
are added or removed, with correct proration. This is the most
Stripe-API-heavy piece of the whole plan — needs `subscriptionItems`
usage, not just a one-time checkout.

**Effect on the homeowner:**
- While sponsored, `User.plan` should reflect the sponsored tier.
- **Open question, needs a decision before building:** if a homeowner
  already has their own paid personal subscription and gets sponsored,
  does the personal one pause, cancel, or stack? I'd recommend pause +
  resume on sponsorship end, but this is a product call, not mine to make.
- **Open question:** on sponsorship end (enterprise removes them, or
  cancels), does the homeowner drop straight to FREE, or get a grace
  period? Affects whether `EnterpriseSponsorship.endedAt` needs a
  `gracePeriodEndsAt` companion field.

**New UI:** Enterprise Portal needs a "Sponsored Homeowners" view
(add/remove, seat usage vs. limit). Admin Portal needs visibility into
sponsorship-driven MRR separately from direct homeowner MRR, since it's
a different revenue source with different churn dynamics.

**Dependency note:** this phase needs *some* notion of "this homeowner
belongs to this enterprise" to exist before it can sponsor them. Phase 3
(invitation flow) is what naturally creates that relationship. Building
Phase 2 before Phase 3, as ordered, means Phase 2 needs its own minimal
"link an existing homeowner to this org for sponsorship purposes" action
— narrower than full invitation, but a real piece of surface area that
Phase 3 will likely want to absorb/replace later. Worth deciding now
whether that's acceptable throwaway work or whether the order should flip.

---

## Phase 3: Enterprise homeowner invitation flow

**Goal:** an Enterprise (optionally via an approved installer) invites a
homeowner by email; accepting creates or links their account and
establishes the Enterprise relationship — distinct from and prior to any
specific device being linked (Phase 1 stays a separate, later step).

**Schema:**
- New model `EnterpriseHomeownerInvite`: `orgId`, `email`,
  `invitedByUserId`, `invitedViaInstallerId` (nullable — set when an
  installer sent it on the enterprise's behalf), `status`
  (PENDING/ACCEPTED/EXPIRED), `token`, `createdAt`, `expiresAt`.

**Flow:**
1. Enterprise (or an approved installer in their network — depends on
   Phase 4 existing) sends an invite by email.
2. If no `User` exists with that email: acceptance flow creates one
   (name + password capture, similar to normal signup but arriving via
   an invite token instead of the public registration form).
3. If a `User` already exists: accepting just establishes the
   relationship on their existing account — no new credentials needed.
4. Accepting **does not** auto-link any device — that stays Phase 1's
   job, kept as a deliberately separate consent step. Recommend the
   acceptance screen offer "link a device now" as a next action, calling
   the *existing* Phase 1 flow rather than a shortcut around it.

**Referral interaction:** if `invitedViaInstallerId` is set, accepting
should also create a real `InstallerReferral` row so the installer gets
credit through the *existing* referral/commission system — not a
parallel one. This is the main integration point with infrastructure
that already works; get this wrong and installer commissions silently
don't fire for enterprise-sourced homeowners.

---

## Phase 4: Enterprise-installer network + admin approval

**Goal:** an Enterprise can invite installers into its network; the
relationship needs both installer consent and platform-admin approval
before it's real.

**Schema:**
- New model `EnterpriseInstallerNetwork`: `orgId`, `installerId`,
  `status` (INVITED/INSTALLER_ACCEPTED/ADMIN_APPROVED/REJECTED/REMOVED),
  `invitedAt`, `installerRespondedAt`, `adminApprovedByUserId`,
  `adminApprovedAt`.

**Open question, needs a decision before building:** the spec says
"Admin approving enterprise-installer relationships" but doesn't say
whether the installer also needs to consent, or just the admin. Given the
consent-first principle established in Phase 1, I'd recommend requiring
*both* — installer accepts, then admin approves — rather than an
enterprise being able to unilaterally claim an installer with only admin
sign-off. Worth confirming explicitly, since it changes the state machine.

**Open question:** what does an approved relationship actually *grant*?
The spec doesn't say. Candidates: the installer becomes selectable as
`invitedViaInstallerId` in Phase 3's invitation flow; the installer gets
visibility into the enterprise's properties or referred homeowners; or
it's purely informational (a network list, no functional access change).
This needs to be pinned down before the schema's `status` transitions and
any associated permission checks can be written correctly.

---

## Phase 5: Admin invitation/creation of enterprise administrators

**This phase needs a scoping decision before anything else, given what
already exists:**

- **If this means** "an admin can directly provision a new org + owner,
  bypassing the request-access lead queue" — that's a small, additive
  change to the already-built `POST /api/admin/enterprise-requests/[id]/approve`
  pathway (add a second admin-initiated entry point that skips the lead
  step).
- **If this means** "multiple people can administer one existing org" —
  that requires fixing the `EnterpriseTeamMember` gap found above: adding
  a `userId`, a real invite-and-accept flow (mirroring Phase 3's
  account-creation-on-accept pattern), and deciding what each of the
  existing `Owner/Admin/Manager/Viewer` role strings actually restrict
  today (currently: nothing — they're display-only labels with no
  permission checks anywhere in the Enterprise Portal's routes).

These are different amounts of work and different features. Recommend
picking one explicitly rather than building toward an ambiguous target.

---

## Phase 6: Annual enterprise billing

**Depends on Phase 2's subscription-creation work existing first** — you
can't choose a billing cycle for a subscription that isn't created yet.
Once that exists: add `EnterpriseOrg.billingCycle` (MONTHLY/ANNUAL), and
either maintain separate annual Stripe Price IDs per plan tier or use
Stripe's built-in proration when switching cycles on an existing
subscription. Recommend sequencing this immediately after Phase 2's
billing foundation, not as a late add-on, since retrofitting a billing
cycle onto a subscription model built without one in mind is more
disruptive than designing for both from the start.

---

## Phase 7: Unified audit trail

**Goal:** one reportable timeline across enterprise actions, installer
referrals, homeowner onboarding, billing, and VPP activity.

**Real architectural choice needed:** today there's `EnterpriseAuditLog`
(enterprise-scoped) and no equivalent for installer referral changes,
billing events, or VPP payouts as an *auditable* trail — that data exists
but scattered across `InstallerReferral`, `Order`/`SellerPayout`-style
records, and `VppPayout`, none of which were built as audit logs.

Two real options, not a small pick:
- **(a) One new `PlatformAuditLog` table** that every relevant write path
  (across all 5 portals) writes to going forward. Cleanest long-term
  query story, but touches write-paths across the whole platform —
  meaningful surface area, real regression risk if any write path is
  missed.
- **(b) A read-only aggregation layer** that queries the existing
  separate tables at report-generation time and merges them. Zero risk
  to existing write paths, but slower queries and more complex
  report-building code, and it inherits any gaps already in those
  existing tables (e.g., installer referral status *changes* aren't
  timestamped anywhere today beyond `referredAt` — there's no history of
  intermediate state transitions to aggregate even if we wanted to).

Recommend deciding (a) vs (b) explicitly — this is the phase most likely
to be underestimated if treated as "just add a query."

---

## Suggested sequencing note

Given the dependency you may not have had full visibility into: Phase 2
as ordered needs Phase 3's relationship-creation capability (or a
narrower stand-in for it), and Phase 6 needs Phase 2's subscription
plumbing. The phases can stay in this order, but Phase 2's scope should
explicitly include "minimal enterprise-homeowner linking, prior to full
Phase 3 invitations" so it isn't blocked, and Phase 6 should be scoped
assuming Phase 2's Stripe subscription work is already in place by the
time it starts.

---

## Phase 1 — confirmed complete, verified against your exact flow

| Your spec | Implementation |
|---|---|
| Enterprise admin requests link by email | `POST /api/enterprise/properties/[id]/link-device`, body `{homeownerEmail}` |
| Homeowner receives request | Real-time `Notification` record created, type `ENTERPRISE_DEVICE_LINK_REQUEST` |
| Homeowner logs in | Consent banner (`EnterpriseLinkRequestBanner`) shown at the top of their dashboard |
| Homeowner selects which device(s) to share | `GET /api/users/me/device-link-requests` returns only *their own* unlinked devices — the enterprise-side endpoint contains zero device queries, so it cannot leak a device list it never fetches |
| Homeowner approves | `POST /api/users/me/device-link-requests/[id]/respond` |
| System links approved device(s) | Sets `Device.enterprisePropertyId`, re-verifying device ownership server-side rather than trusting client input |

No changes needed here. Confirmed via direct code inspection immediately
above this document being written, not from memory of having built it.
