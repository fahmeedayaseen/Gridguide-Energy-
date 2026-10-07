# GridGuide Platform — Deployment Guide

## Quick Start (Vercel + Neon Postgres)

### 1. Install dependencies
```bash
npm install
npx prisma generate
```

### 2. Environment variables
Copy and fill in `.env.example`:
```bash
cp .env.example .env.local
```

Minimum required:
```
DATABASE_URL=postgresql://user:pass@host/gridguide
REDIS_URL=redis://...
JWT_SECRET=<64 random chars>
JWT_REFRESH_SECRET=<64 random chars>
NEXT_PUBLIC_APP_URL=https://gridguide.ai
ADMIN_EMAIL=admin@gridguide.ai
ADMIN_PASSWORD=<strong password>
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
SENDGRID_API_KEY=SG....
```

### 3. Database setup
```bash
npx prisma migrate deploy   # run all migrations
npm run db:seed             # creates admin account only (no fake data)
npm run db:seed:vpp         # seeds Leap + Enel VPP provider records
npm run db:seed:geo         # seeds US utility territory data
```

### 4. Deploy
```bash
npx vercel --prod
```

### 5. Stripe webhook
Add endpoint in Stripe Dashboard:
```
https://gridguide.ai/api/payments/webhook
```
Events: subscription.created, subscription.updated, subscription.deleted, invoice.payment_succeeded

---

## Docker
```bash
docker-compose up -d
docker exec -it gridguide-web npx prisma migrate deploy
docker exec -it gridguide-web npm run db:seed
```

---

## First Login
Visit `https://gridguide.ai/platform` → Admin Portal
Use `ADMIN_EMAIL` / `ADMIN_PASSWORD` from your `.env`
**Change password immediately after first login.**

---

## Referral System Notes
- Installer codes: `GG-XXXXXX` — stored on `Installer.referralCode`
- Homeowner codes: `GGH-XXXXXX` — stored on `User.personalReferralCode`
- Both auto-generated at account creation
- Credit chain: signup → InstallerReferral/HomeownerReferral → Stripe webhook → InstallerRevenueShare → payout
