# GridGuide.ai Membership Implementation

Implemented consumer membership structure for:

- FREE
- PRO
- ENTERPRISE

## Added backend files

- `lib/memberships.js` — central source of truth for plan features, limits, upgrade checks, and public plan payloads.
- `app/api/memberships/route.js` — public plan details for pricing/membership pages.
- `app/api/memberships/status/route.js` — authenticated membership status, limits, and usage.
- `app/api/memberships/checkout/route.js` — Stripe checkout redirect for Pro membership.

## Added frontend pages

- `app/page.jsx` — GridGuide.ai homepage with Get Started Free and Compare Memberships links.
- `app/membership/page.jsx` — Free / Pro / Enterprise comparison cards.
- `app/enterprise/contact/page.jsx` — Enterprise sales/contact page.
- `app/layout.jsx` — minimal App Router layout so pages can render.

## Added feature enforcement

- Free device limit: 3 connected devices.
- Free utility connection limit: 1 utility connection.
- AI chat limits by plan:
  - Free: 10 messages/hour
  - Pro: 60 messages/hour
  - Enterprise: 300 messages/hour
- VPP participation requires Pro or Enterprise.

## Stripe fields added to Prisma User

- `stripeSubscriptionId`
- `membershipStatus`

Existing fields used:

- `plan`
- `planExpiresAt`
- `stripeCustomerId`

## Stripe webhook behavior

- Checkout completion with `type=consumer_membership` upgrades user plan.
- Subscription created/updated keeps plan, status, subscription ID, and renewal date synced.
- Subscription deleted downgrades user to Free.

## Frontend links

- Free: `/register?plan=FREE`
- Pro: `/api/memberships/checkout?plan=PRO`
- Enterprise: `/enterprise/contact`

## Environment variables needed

- `STRIPE_PRICE_CONSUMER_PRO`
- `STRIPE_PRICE_CONSUMER_ENTERPRISE` if Enterprise becomes self-serve
- `NEXT_PUBLIC_APP_URL`

## Portal zip note

This backend now exposes membership status and plan data. Upload the dashboard, seller, installer, and admin portal zips individually so the same Free / Pro / Enterprise UI and guards can be inserted directly into each portal.
