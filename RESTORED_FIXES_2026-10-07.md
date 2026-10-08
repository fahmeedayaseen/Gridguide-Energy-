# Restored fixes — 2026-10-07

The v3 codebase pushed to GitHub on 2026-10-07 was missing most fixes from the July–September engineering rounds. This branch re-applies them against the current code (not by copying old files), plus several new bugs found along the way.

## Before deploying

1. Apply migrations, in order:
   - `20261007_installer_notification_prefs`
   - `20261007_installer_fee_normalization`
   - `20261007_proposal_view_token`
   - `20261007_vpp_projected_rate`
   - `20261007_vpp_controls_and_estimates`
2. Run the manual-review query at the bottom of `20261007_installer_fee_normalization` to find installers on PRO/ENTERPRISE with no Stripe subscription (anyone could self-upgrade before this fix).
3. Set `ENERGYHUB_ENABLED="false"` (new in `.env.example`).
4. Make sure the delivery-job cron (`/api/cron/process-delivery-jobs`) is scheduled; proposal emails go through it.

## Billing & money
| Problem | Fix |
|---|---|
| `POST /api/installers/membership` set any requested plan (incl. ENTERPRISE) with or without payment | Paid plans return a Stripe Checkout URL; access is granted only by the webhook |
| Registration accepted `plan: PRO/ENTERPRISE` with no payment | New installers always start on Free; requested paid plan goes to checkout |
| Webhook treated installer subscriptions as homeowner ones (unknown price → HOMEOWNER_PLUS) | Installer subscriptions handled separately by `lib/installer-billing.js` |
| Paid access kept in past_due / unpaid / incomplete states; failed invoices ignored | Only active/trialing keeps paid access; `invoice.payment_failed` drops to Free immediately |
| Upgrading Pro → Enterprise would have billed both subscriptions | Previous subscription cancelled once the new one is paid |
| Lead success fee used nonexistent `BASIC` plan and 9/6/5% rates; jobs fell back to 8% | `lib/installer-plans.js` is the single source (admin-configurable 10/7/5%) |
| `Installer.successFeeRate` default 0.05 (Enterprise rate), `vppSharePct` default 0.05 | Defaults 0.10 / 0, plus normalization migration |
| Admin refunds read nonexistent `stripePaymentIntentId` — every refund blocked | Uses `stripePaymentId`; refunds above the order total rejected |
| Admin order audit log used fields that don't exist (silently failed) | Real `PlatformAuditLog` fields |
| Lead → CONVERTED 500'd when a job already existed | Creates the job once |

## Fake data replaced with real data
Installer: Jobs, Schedule, Leads (contact details redacted server-side for Free), Proposals (create / email / accept / decline / delete), Interconnection, Earnings, Reviews, Profile, Payments (real plan, Stripe invoices, billing portal), dashboard KPIs and plan card. `IDATA` removed.

Admin: Sales (demo orders removed; API shape fixed), Payouts (new `GET /api/admin/payouts`), Users, System Status. `ADATA` removed.

Homeowner: installer directory (real verified installers), thermostat VPP banners (real enrollment/next event). Seller CRM demo fallback removed.

## Unsupported claims removed
Pricing "pays for itself / break even in month one", "$45–$120/month", "$80 avg per event / 4–6 events/month", blog "$500–$1,200 annually", geo-intelligence fake per-ISO dollar ranges and synthesized "$X–Y/yr" preview, fake `enrolled: true` flags. AI assistant told not to quote VPP earnings. Installer VPP projection is an admin-set, labeled assumption.

## VPP
- **Security:** `GET /api/vpp/providers` returned raw partner API keys and webhook secrets to any signed-in user. Fixed.
- Provider `publicVisible` / `enrollmentOpen` controls, EnergyHub double gate, admin control card.
- Program routing: state/utility filters no longer overwrite each other; only enrollable providers.
- Opt-out: `CANCELLATION_PENDING` / `CANCELLATION_FAILED` instead of claiming partner cancellation.
- Events scoped to their program; participation rows created; per-event opt-out.
- Webhook retries de-duplicated; `event.updated` no longer duplicates events.
- `VppProgramEarningsEstimate` (verified, time-boxed) is the only source of VPP dollar figures.

## Access fixes (middleware)
Partner invitation landing/accept, public proposal view, public VPP providers and community-impact stats were returning 401 before their handlers ran.

## Still not done (needs outside input)
- Leap / Enel / EnergyHub API contracts (enroll, cancel, event ack payloads) — placeholders until partner docs arrive.
- Stripe Connect payout onboarding UI for installers.
- Notification preferences are stored but no sender reads them yet.
- Several catch-all routes still return fake "connected" responses: `/api/seller/[...path]`, `/api/billing/[...path]`, `/api/payments`, `/api/vpp`, `/api/utility`, `/api/geo`, `/api/energy/forecast`, `/api/devices/thermostat`, `/api/memberships/free`, `/api/enterprise/contact`.
- The thermostat screen's controls (temperature, schedule, devices) are still local demo state.
- No build, `prisma validate`, or tests were run here (package registry blocked in this environment). All edited files pass a syntax and undefined-name check, and all named imports resolve.
