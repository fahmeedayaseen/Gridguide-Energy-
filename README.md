# GridGuide — Full Stack Platform

Energy management SaaS with two public sites, three portals, and a complete API.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  GridGuideEnergy.com        GridGuide.ai                        │
│  Marketing & installers     Consumer dashboard & AI              │
└────────────────────┬────────────────────┬───────────────────────┘
                     │                    │
      ┌──────────────┼────────────────────┼──────────────┐
      │              │   Next.js App      │              │
      ▼              ▼                    ▼              ▼
  Installer      Seller Portal      Admin Panel    Consumer App
  Portal         /portal/seller     /admin         /dashboard
  /portal/installer
      │              │                    │              │
      └──────────────┴────────────────────┴──────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Next.js API      │
                    │   104 routes       │
                    └─────────┬──────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         PostgreSQL         Redis         Stripe / S3
```

## Quick Start

```bash
# 1. Install deps
npm install

# 2. Copy env file and fill in values
cp .env.example .env.local

# 3. Start local services
docker-compose up postgres redis -d

# 4. Run migrations and seed
npx prisma migrate dev --name init
npm run db:seed

# 5. Start dev server
npm run dev
# → http://localhost:3000
```

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Consumer | alex@example.com | demo123 |
| Installer | hello@suntechsolutions.com | install2026 |
| Seller | seller@suntechproducts.com | seller2026 |
| Admin | admin@gridguide.ai | admin2026 |

## API Routes (104 endpoints)

### Auth
- `POST /api/auth/register` — Create account
- `POST /api/auth/login` — Login, returns JWT
- `POST /api/auth/logout` — Invalidate token
- `POST /api/auth/refresh` — Refresh access token
- `POST /api/auth/2fa` — Verify 2FA code
- `POST /api/auth/forgot-password` — Send reset email
- `POST /api/auth/reset-password` — Reset with token

### Consumer
- `GET/PATCH /api/users/me` — Profile
- `GET/POST /api/devices` — Connected devices
- `GET/PATCH /api/devices/thermostat` — Thermostat control
- `GET /api/energy/forecast` — AI energy forecast
- `GET/POST /api/utility` — Utility connection
- `GET /api/utility/usage` — Usage data
- `GET /api/vpp` — VPP status
- `POST /api/vpp/enroll` — Enroll in VPP
- `GET /api/vpp/earnings` — VPP earnings
- `GET /api/rewards` — Rewards balance
- `GET /api/marketplace/products` — Browse products
- `POST /api/marketplace/orders` — Place order
- `GET/POST /api/payments/cards` — Payment methods

### Installer Portal
- `GET/PATCH /api/installers/profile` — Profile + certifications + zones + stats
- `GET/POST /api/installers/leads` — Lead management
- `GET/POST/PATCH/DELETE /api/installers/proposals` — Proposal lifecycle
- `GET/POST/PATCH /api/installers/jobs` — Jobs + permit/IC status + payout on complete
- `GET/POST/PATCH /api/installers/interconnection` — Utility IC tasks grouped by job
- `GET/POST/PATCH /api/installers/permits` — Permit tracking
- `GET /api/installers/earnings` — Payout history
- `GET /api/installers/revenue` — Revenue partner metrics
- `GET /api/installers/referrals` — Homeowner referrals
- `GET/POST/DELETE /api/installers/certifications` — Credentials
- `GET/POST/DELETE /api/installers/service-zones` — Territory management
- `POST /api/installers/register` — Apply to join
- `GET /api/installers/schedule` — Job schedule
- `GET /api/installers/reviews` — Customer reviews
- `GET /api/installers/vpp-earnings` — VPP revenue

### Seller Portal
- `POST /api/sellers/register` — Apply to sell
- `GET/POST/PATCH /api/marketplace/products` — Product management
- `GET /api/marketplace/orders` — Order management

### Admin
- `GET /api/admin/stats` — Platform KPIs
- `GET /api/admin/users` — User management
- `PATCH /api/admin/users/[id]` — Update user
- `GET/PATCH /api/admin/installers` — Installer network + revenue metrics
- `GET/PATCH /api/admin/sellers` — Seller management
- `GET /api/admin/analytics` — Revenue analytics
- `GET /api/admin/products` — Marketplace products

### Billing
- `POST /api/billing/checkout/pro` — Start Pro subscription
- `POST /api/billing/checkout/enterprise` — Start Enterprise
- `POST /api/payments/webhook` — Stripe webhook handler
- `GET/POST /api/payments/payouts` — Payout management
- `POST /api/payments/withdraw` — Request withdrawal

### VPP
- `GET /api/vpp/events` — Event listing
- `GET /api/vpp/participants` — Event participants
- `POST /api/vpp/operations` — Dispatch event
- `GET /api/vpp/payouts` — Payout status

### Other
- `GET /api/geo/search` — Address autocomplete
- `GET /api/geo/installers` — Installers near location
- `POST /api/ai/chat` — AI energy assistant
- `POST /api/upload` — File upload to S3
- `GET /api/cron` — Cron job endpoint

## Deploy

### Vercel (recommended)
```bash
npx vercel --prod
# Set env vars in Vercel dashboard
# Add DATABASE_URL (Supabase/Neon) and REDIS_URL (Upstash)
```

### Railway
```bash
railway up
# Railway auto-provisions PostgreSQL and Redis
```

### Docker
```bash
docker-compose up --build
```

## Database

```bash
# Apply migrations
npx prisma migrate dev --name <name>

# Full reset + reseed
npx prisma migrate reset
npm run db:seed

# Open studio
npm run db:studio
```

## Key Installer Portal Database Tables

| Table | Purpose |
|-------|---------|
| `Installer` | Company profile, plan, revenue share %, referral code |
| `InstallerLead` | Homeowner leads with status pipeline |
| `Job` | Jobs with permitStatus, interconnectionStatus |
| `Proposal` | DRAFT→SENT→ACCEPTED lifecycle |
| `InterconnectionTask` | Utility IC tasks per job |
| `Permit` | Permit tracking per job |
| `InstallerCertification` | GridGuide, NABCEP credentials |
| `ServiceZone` | Geographic coverage areas |
| `InstallerPayout` | Gross/fee/net payout per completed job |
| `InstallerReferral` | Homeowner referral tracking for revenue share |
| `InstallerRevenueShare` | Monthly revenue share calculations |

## Revenue Model

| Plan | Monthly Fee | Success Fee | Rev Share |
|------|-------------|-------------|-----------|
| Free | $0 | 10% | 15% |
| Pro | $99 | 7% | 25% |
| Enterprise | $499 | 5% | 30% |

VPP split by installer referral tier (homeowner / GridGuide / installer):
- Organic (no installer referral): 80% / 20% / 0%
- Pro installer referral: 75% / 20% / 5%
- Enterprise installer referral: 75% / 15% / 10%

Marketplace: 5–10% commission on completed sales
