# GridGuide Production Database Guide

## Database engine

GridGuide is configured for PostgreSQL through Prisma.

Required environment variable:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public"
```

## Included database coverage

The Prisma schema includes tables for:

- Users, sessions, authentication, roles, memberships, subscriptions
- Admin portal users, analytics, audit/activity logs, platform settings through API-backed records
- Installer portal profiles, leads, jobs, proposals, permits, interconnection tasks, certifications, service zones, payouts, referrals, revenue share, and VPP earnings
- Seller portal profiles, products, orders, order items, seller payouts, commissions, and marketplace records
- Consumer dashboard properties, devices, thermostats, utility accounts, utility usage linkage, rewards, redemptions, wallet, withdrawals, cards, payout preferences, notifications, AI chats, VPP enrollment, VPP events, VPP payouts, and rebate claims
- Enterprise organizations, members, properties, VPP programs, VPP operations, revenue transactions, and payout batches
- Community posts, replies, signup events, and user activity logs
- Geo/utility support tables including ZIP code and utility territory references

## No fake data policy

The package intentionally does not create fake homeowners, fake installers, fake sellers, fake marketplace products, fake orders, fake proposals, fake jobs, fake payouts, fake utility connections, or fake VPP events.

The only seeded record is the first admin account, created from environment variables:

```bash
ADMIN_EMAIL="admin@yourdomain.com"
ADMIN_PASSWORD="replace-with-strong-password"
```

## Local setup

```bash
cd web
cp .env.example .env.local
# edit DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, JWT secrets, SendGrid, Stripe, etc.
docker-compose up postgres redis -d
npm install
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

## Hosted setup

For Vercel/Railway/Render/Supabase/Neon:

```bash
cd web
npm install
npx prisma generate
npx prisma db push
npm run db:seed
npm run build
npm run start
```

## Production migration option

After connecting the real database, create the first migration from the included schema:

```bash
cd web
npx prisma migrate dev --name init
npx prisma migrate deploy
npm run db:seed
```

Commit the generated `web/prisma/migrations` folder before deploying.

## Required live integrations before launch

The database schema is ready, but production launch still needs real keys and provider accounts:

- SendGrid API key and verified sender/domain
- Stripe account, price IDs, webhooks, and Connect if paying sellers/installers
- Utility data provider credentials
- File storage bucket credentials
- Redis/Upstash URL for rate limiting/session support
- Strong JWT/NEXTAUTH secrets

