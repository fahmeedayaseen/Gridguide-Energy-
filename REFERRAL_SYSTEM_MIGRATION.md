# Referral System — Migration Guide

## What was added

### Schema changes
- `User.subscriptionStatus` — tracks Stripe subscription state
- `User.currentPeriodEnd` — subscription renewal date
- `InstallerReferral.referredAt` — when homeowner signed up
- `InstallerReferral.activatedAt` — when homeowner connected first device
- `InstallerReferral.subscribedAt` — when homeowner upgraded to paid plan

### New API routes
| Route | Purpose |
|---|---|
| `POST /api/auth/register` | Updated — captures `referralCode`, creates `InstallerReferral`, notifies installer |
| `POST /api/installers/referrals/convert` | Called when user upgrades plan — updates revenue share |
| `GET/POST /api/installers/referrals/link` | Returns referral link/QR code, regenerates code |
| `POST /api/payments/webhook` | Updated — triggers referral conversion on Stripe subscription events |

### Full referral flow
1. Installer shares `https://gridguide.ai/signup?ref=GG-ST4842`
2. Homeowner opens link → signup form auto-fills referral code field
3. `POST /api/auth/register` with `referralCode: "GG-ST4842"`
4. Backend finds installer by `referralCode`, creates `InstallerReferral` with status `referred`
5. Installer gets a push notification: "New Referral: [Name]"
6. Homeowner connects device → status updates to `activated`
7. Homeowner subscribes → Stripe webhook fires → `referral.convert` runs
8. Installer's `monthlyReferralEarnings` increments, `InstallerRevenueShare` record created
9. Installer notified: "Referral Converted! 🎉 You're earning $2.50/month"

## Deploy
```bash
npx prisma migrate dev --name referral_system
npm run db:seed
```

## Environment variables needed
```
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONSUMER_PRO_PRICE_ID=price_...
STRIPE_INSTALLER_PRO_PRICE_ID=price_...
STRIPE_INSTALLER_ENT_PRICE_ID=price_...
NEXT_PUBLIC_APP_URL=https://gridguide.ai
```
