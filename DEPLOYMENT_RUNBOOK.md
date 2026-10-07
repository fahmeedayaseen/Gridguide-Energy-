# GridGuide — First Real Deployment Runbook

## Direct answer to "is this ready for the team to go live with"

**The code is complete and as thoroughly verified as it's possible to be
without a live server or database.** Every backend file passes syntax
validation, every schema relationship is checked for integrity, a full
security/permission audit has been done, and every feature built this
session has been reviewed and cross-checked multiple times.

**But none of it has ever actually been run.** No `npm install`, no
`prisma generate`, no `next build`, no `prisma migrate deploy` has ever
executed against real infrastructure — the sandbox this was built in has
no network access and no database engine. This is the first time any of
this code will actually execute anywhere.

Treat this as: **very high confidence the code is correct, zero
confidence yet that it runs clean on the first try**, because it
categorically hasn't been tried. That's not a hedge — it's the honest
gap between static review and execution, and the whole reason this
runbook exists.

---

## Before you start: what you need

- A real Postgres database (managed — Neon, Railway, Supabase, RDS — or
  self-hosted). Get its connection string.
- Real API keys/secrets for whatever you're launching with: Stripe
  (price IDs for every plan tier — see `.env.example`, 7 of these are
  enterprise-specific and easy to miss), SendGrid or similar for email,
  Google Places API key if using address autocomplete, Redis instance
  (Upstash or self-hosted) for caching/rate-limiting.
- A deploy target: Vercel is the path of least resistance for a Next.js
  app; Railway/Render/self-hosted all work too.

## Step by step

### 1. Install dependencies
```bash
npm install
```
This also triggers `prisma generate` automatically (see `postinstall` in
`package.json`). If it doesn't, run `npx prisma generate` manually.
**This is the very first moment the Prisma schema itself gets validated
by real tooling** — if there's a schema-level mistake my static relation
checker couldn't catch, this is where it surfaces.

### 2. Configure environment variables
Copy `.env.example` to `.env` (or your platform's env var settings) and
fill in every real value. Then run:
```bash
npm run verify:env
```
This checks for missing required vars and warns (non-fatally) about
missing Stripe price IDs — including the enterprise-specific ones, which
were the exact gap this script was fixed for earlier this session.

### 3. Run the migrations — for real, for the first time
```bash
npm run db:migrate:prod
```
(`prisma migrate deploy`). This applies all 20 migrations in this
project, in order, against your real database. **Watch the output
closely.** Things to check specifically, since they were hand-written
without ever being run:
- Every migration should report success with no errors.
- If any migration fails partway, **stop and don't retry blindly** —
  check which statement failed and whether a prior migration in the
  sequence needs a fix first.

### 4. Seed reference data (optional but recommended for testing)
```bash
npm run db:seed          # admin account + core platform config
npm run db:seed:dev      # sample users across every role, for testing
npm run db:seed:geo      # utility territory / ISO data
npm run db:seed:utilities
npm run db:seed:vpp
```

### 5. Build
```bash
npm run build
```
**This is the first real check of the entire ~19,000-line frontend
file.** My verification throughout this project has only ever been brace
and paren balance counting — never actual JSX parsing. A real Next.js
build does full syntax/type checking across every component. If this
fails, the error output will point at an exact file and line — bring
that back and I can fix it directly.

### 6. Start it and smoke-test manually
```bash
npm start
```
Before any automated testing, manually walk through at minimum:
- Register a new homeowner account, confirm login works
- Log into each portal (Homeowner, Installer, Seller, Enterprise, Admin)
  and confirm the dashboard loads with no console errors
- Try one write action per portal (add a property, submit a rebate, etc.)

### 7. Then the rest of the original checklist
Route crawling, integration tests, load testing, and the portal-by-portal
workflow testing all make sense *after* steps 1–6 succeed — there's no
point automating tests against a build that hasn't been confirmed to
even start yet.

---

## If something fails

Bring the exact error output back to this conversation. Static review
can miss things that only surface at runtime — that's expected, not a
sign the prior work was wrong, just the known limit of what could be
checked without execution. I can fix real errors quickly once I can see
them; I can't predict every one of them in advance from a sandbox with
no way to run any of this itself.

## What's genuinely NOT done yet, stated plainly

- No automated test suite exists in this project (noted from early in
  this engagement) — testing has been manual code review throughout, not
  executed test coverage.
- No load/performance testing has ever been possible to do.

## Changed since this runbook was first written (2026-07-06)

This document was written once and needs to be actively kept in sync,
not treated as fixed at creation — this section exists so a stale claim
here never quietly contradicts the actual current state of the code.

- The installer-referral issue mentioned in earlier drafts of this
  runbook **has since been fixed**, and turned out to matter more than
  first flagged. Self-reported installer referrals (manual add or bulk
  import) can no longer earn real commission or VPP revenue share until
  either the claimed homeowner confirms the relationship or an admin
  approves it. A separate, unauthenticated endpoint that could credit
  real money to any installer with no login at all was also found and
  removed during this fix. See `DEPLOYMENT_CHECKLIST.md` for the full
  writeup if you want the details.
- The same verification standard was checked against the homeowner
  referral system (confirmed already safe by design — no self-report
  path exists there) and the Enterprise portal (confirmed already
  correctly consent-gated in every place except one, which is now
  fixed too).
