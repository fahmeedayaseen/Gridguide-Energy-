# GridGuide Backend Bug Fixes

## Test/validation run
- Ran JavaScript syntax checks with `node --check` across every `.js` file in the backend project.
- Ran static import/export validation for local modules.
- Ran static Prisma usage checks comparing route `data` fields against `schema.prisma` model fields.
- `npm run lint` and `next build` could not be completed in this sandbox because dependencies were not included in the zip and `npm install` timed out before completion.

## Fixes applied

### 1. Authentication helpers restored
- Added missing password hash/verify helpers used by login/register/reset flows.
- Added missing `loginSchema` and `registerSchema` Zod validators.
- Added missing `setTokenCookies` and `clearTokenCookies` helpers so login, register, refresh, and logout can set/clear auth cookies correctly.

### 2. JWT helper exports fixed
- Added `issueTokens`, `signAccessToken`, `signRefreshToken`, `verifyRefreshToken`, and `extractBearer` exports to match the API routes that import them.
- Kept middleware-compatible token payload fields: `sub`, `email`, `role`, and `plan`.
- Added safe development fallback secrets so local tests do not crash when environment variables are missing. Production should still set real `JWT_SECRET` and `JWT_REFRESH_SECRET`.

### 3. Redis/local development stability fixed
- Reworked Redis helper to fall back to an in-memory implementation when `REDIS_URL` is missing or Redis cannot connect.
- Added missing Redis-like methods used by routes, including `incr`, `set` with options, `lPush`, and sorted-set helpers for rate limiting.
- This prevents the backend from crashing during local development or test runs when Redis is not running.

### 4. Prisma schema errors fixed
- Removed duplicate `QUOTED` enum value from `LeadStatus`.
- Expanded `RebateClaim` to match the rebate application routes, adding fields such as `programId`, `programType`, `category`, applicant details, install date, system size, timestamps, and indexes.
- Added missing claim statuses used by routes: `CLAIMED` and `EXPIRED`.
- Added missing model relations for address verification, reward redemptions, wallet, withdrawals, Grid Fund donations, and installer location.
- Added missing `creditBalance` field on `User` for statement-credit reward redemptions.
- Added missing `lifetimeRedeemed` field on `Reward`.
- Added missing `type` and `metadata` fields on `RewardTransaction`.

### 5. Rebate application route fixed
- Replaced invalid `include: { address: true }` on `User` with a lookup against `AddressVerification`, matching the existing schema.
- This fixes rebate eligibility checks by state without requiring a nonexistent `User.address` relation.

## Front-end to back-end impact
- Login/register/logout/refresh routes now match the helper functions expected by the front end.
- Auth cookies are set and cleared consistently so the front end can stay logged in while moving between GridGuide pages and API-backed dashboard screens.
- Rebate, reward, and wallet-related endpoints now align better with the database schema, reducing front-end 500 errors from Prisma field mismatches.
