# GridGuide Credit & Commission System

## Overview
This document covers the credit-based rewards economy and recurring
installer commission engine added to GridGuide.

## Credit Economics (admin-adjustable via Admin → Rates & Credits)

| Setting | Default | Field in PlatformConfig |
|---|---|---|
| Credits per dollar | 1,000 credits = $1.00 | `creditsPerDollar` |
| Homeowner referral bonus | 2,500 credits ($2.50), one-time | `homeownerReferralCredits` |
| Monthly redemption cap | 2,500 credits ($2.50)/month | `monthlyRedemptionCapCredits` |
| Homeowner subscription price | $9.99/month | `homeownerSubscriptionPrice` |

## Installer Commission (admin-adjustable)

| Plan | Revenue Share |
|---|---|
| Free | 15% |
| Pro | 25% |
| Enterprise | 30% |

**Critical rule:** commission is recalculated every billing cycle using the
installer's **current** plan tier at the time of billing — never a cached
rate from when the referral was made. If an installer upgrades from Free to
Pro mid-month, their existing referrals start earning the Pro rate on the
**next** billing cycle, not retroactively.

## Database Models

- **`PlatformConfig`** — singleton row holding every adjustable rate.
- **`CreditAccount`** — one per homeowner, tracks balance/lifetime earned/redeemed.
- **`CreditTransaction`** — full ledger of every credit earn and redemption.
- **`CreditRedemption`** — one row per user per billing month, enforces the cap via a unique constraint on `(userId, periodMonth, periodYear)`.
- **`InstallerCommissionLedger`** — one row per installer referral per billing month, records the plan tier and share % actually applied that cycle. Unique on `(installerReferralId, periodMonth, periodYear)` so the job is safe to re-run.
- **`HomeownerReferral.creditsAwarded`** — credits awarded for this specific referral (defaults to the platform setting at time of award).

## API Routes

| Route | Purpose |
|---|---|
| `GET /api/rewards/wallet` | Homeowner's credit balance + this month's redemption cap status |
| `POST /api/rewards/redeem` | Redeem credits toward subscription (enforces cap, creates Stripe invoice credit) |
| `GET /api/rewards/transactions` | Credit transaction + redemption history |
| `GET /api/installers/commissions` | Installer's recurring commission report by month |
| `GET /api/admin/rates` | All current platform rates |
| `PATCH /api/admin/rates` | Update any rate (installer share, credit economics, subscription price) |
| `GET /api/admin/referrals/analytics` | Combined homeowner + installer referral program reporting |
| `POST /api/cron/installer-commissions` | Monthly batch job — recalculates commission for every active referral |

## Frontend

- **Homeowner → Rewards tab**: credit balance card, redeem-toward-subscription form with live cap display, referral link, transaction history.
- **Installer → Revenue Partner tab**: referral link/QR/email tools, plan revenue share table, recurring commission report pulling from `InstallerCommissionLedger`.
- **Admin → Rates & Credits**: live-editable form for every rate above, with an instant preview of resulting dollar amounts.
- **Admin → Referral Analytics**: side-by-side homeowner credit program and installer commission program stats, top-installer leaderboard.

## Cron Setup
Add to `vercel.json` or your scheduler:
```json
{
  "crons": [{ "path": "/api/cron/installer-commissions", "schedule": "0 6 1 * *" }]
}
```
Runs the 1st of every month at 6am UTC, after Stripe billing cycles complete.
Protect with `CRON_SECRET` env var.
