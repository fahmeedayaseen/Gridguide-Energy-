# GridGuide VPP Main Database Merge Report

## Status
The Leap / Enel VPP integration layer has been merged directly into this uploaded master GridGuide package.

## Database additions
Added production-safe Prisma database models and migration SQL for:

- `vpp_providers` — Leap, Enel, and future VPP partners
- `vpp_programs` — utility/state/ISO/grid program rules and availability
- `vpp_enrollments` — homeowner VPP consent/enrollment records
- `vpp_events` — partner VPP/grid events received or created by admin/API
- `vpp_event_participation` — homeowner/device participation tracking
- `vpp_revenue_splits` — homeowner/GridGuide/installer revenue split records
- `vpp_provider_webhooks` — inbound Leap/Enel webhook audit log

Also added user relations for:

- `vppProgramEnrollments`
- `vppEventParticipations`
- `vppRevenueSplits`

## Backend additions
Added API routes for:

- `GET/POST /api/vpp/providers`
- `GET/POST /api/vpp/programs`
- `GET/POST /api/vpp/enrollments`
- `GET/POST /api/vpp/events/partner`
- `GET/POST /api/vpp/revenue`
- `POST /api/vpp/webhooks/[provider]`

Added shared service:

- `lib/vpp-partners.js`

This handles:

- Leap/Enel environment configuration
- Provider key normalization
- Partner API client creation
- Homeowner program routing
- Duplicate/conflicting enrollment protection
- Partner enrollment submission when credentials exist
- Revenue split calculation

## Frontend additions
Added VPP pages:

- `/vpp`
- `/vpp/programs`
- `/vpp/events`
- `/vpp/earnings`
- `/admin/vpp`

These give homeowners and admins proper VPP content pages instead of dead links.

## Environment variables added
Add these to production hosting once you have partner approvals:

```env
LEAP_API_KEY=
LEAP_API_BASE_URL=https://api.leap.energy
LEAP_WEBHOOK_SECRET=
ENEL_API_KEY=
ENEL_API_BASE_URL=https://api.enelx.com
ENEL_WEBHOOK_SECRET=
```

## Safe seed file
Added:

- `prisma/seed-vpp-providers.js`

This only seeds provider metadata for Leap and Enel with `PENDING_CREDENTIALS`. It does not create fake homeowners, fake events, fake earnings, or fake enrollments.

## Validation performed
- Confirmed VPP models exist in `prisma/schema.prisma`.
- Confirmed migration SQL exists under `prisma/migrations/20260626_add_vpp_partner_layer`.
- Syntax-checked the new backend route files with `node --check`.
- Confirmed VPP frontend pages were added for homeowner/admin routes.

## Not fully tested here
A full Next.js production build was not run because `node_modules` is not installed in this sandbox. After deployment setup, run:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
```

## Live launch requirement
Leap and Enel dispatch/revenue tracking will stay in pending/local mode until real partner credentials and webhook secrets are installed.
