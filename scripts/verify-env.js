#!/usr/bin/env node
/**
 * Pre-deploy environment check.
 *
 * Run before every production deploy: `node scripts/verify-env.js`
 * Exits non-zero (fails CI / the deploy step) if a REQUIRED variable is
 * missing. Warns (but doesn't fail) on missing OPTIONAL/feature-specific ones.
 *
 * This exists because several past deploys of this app have failed silently
 * due to env var name mismatches between .env.example and the actual code
 * (e.g. STRIPE_INSTALLER_PRO_PRICE_ID vs STRIPE_PRICE_INSTALLER_PRO) — this
 * script checks the REAL names the code reads, not just "is .env.example
 * filled in". Keep this list in sync with .env.example.
 */

const REQUIRED = [
  "DATABASE_URL",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "CRON_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

const REQUIRED_FOR_PAID_PLANS = [
  "STRIPE_PRICE_CONSUMER_PRO",
  "STRIPE_PRICE_CONSUMER_ENTERPRISE",
  "STRIPE_PRICE_SELLER_PRO",
  "STRIPE_PRICE_INSTALLER_PRO",
  "STRIPE_PRICE_INSTALLER_ENTERPRISE",
];

// Missed in the original list - a deploy could pass this check while every
// enterprise billing path (org subscription creation, monthly/annual cycle
// switching, homeowner sponsorship seat billing) fails at runtime the first
// time someone actually exercises it.
const REQUIRED_FOR_ENTERPRISE_BILLING = [
  "STRIPE_PRICE_ENTERPRISE_BASIC",
  "STRIPE_PRICE_ENTERPRISE_PRO",
  "STRIPE_PRICE_ENTERPRISE_SCALE",
  "STRIPE_PRICE_ENTERPRISE_BASIC_ANNUAL",
  "STRIPE_PRICE_ENTERPRISE_PRO_ANNUAL",
  "STRIPE_PRICE_ENTERPRISE_SCALE_ANNUAL",
  "STRIPE_PRICE_ENTERPRISE_SPONSORED_SEAT",
];

const RECOMMENDED = [
  "SENDGRID_API_KEY", "FROM_EMAIL",
  "REDIS_URL",
  "ANTHROPIC_API_KEY",
  "SENTRY_DSN",
  "NEXT_PUBLIC_MAPBOX_TOKEN", "GOOGLE_MAPS_API_KEY",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_S3_BUCKET",
  "UTILITYAPI_KEY", "DERAPI_KEY",
  "GREEN_BUTTON_CLIENT_ID", "GREEN_BUTTON_CLIENT_SECRET", // Green Button Connect My Data (ESPI OAuth 2.0)
];

const PLACEHOLDER_PATTERNS = [/^change-this/i, /\.\.\.$/, /^price_\.\.\.$/, /^sk_test_\.\.\.$/, /^$/];

function isPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(value || ""));
}

function check(list, label, { fatal }) {
  const missing = list.filter((v) => isPlaceholder(process.env[v]));
  if (missing.length === 0) {
    console.log(`✓ ${label}: all set`);
    return true;
  }
  const prefix = fatal ? "✗" : "!";
  console.log(`${prefix} ${label}: ${missing.length} unset or still a placeholder value:`);
  for (const v of missing) console.log(`    - ${v}`);
  return false;
}

console.log(`\nGridGuide environment check (NODE_ENV=${process.env.NODE_ENV || "development"})\n`);

const requiredOk = check(REQUIRED, "Required (app will not run correctly without these)", { fatal: true });
const paidPlansOk = check(REQUIRED_FOR_PAID_PLANS, "Required for paid plan checkout", { fatal: false });
const enterpriseBillingOk = check(REQUIRED_FOR_ENTERPRISE_BILLING, "Required for Enterprise billing (org subscriptions, annual cycle, sponsorship seats)", { fatal: false });
check(RECOMMENDED, "Recommended (email, redis, AI, monitoring, maps, storage)", { fatal: false });

console.log("");

if (!requiredOk) {
  console.error("FAILED: one or more required environment variables are missing. Deployment blocked.\n");
  process.exit(1);
}

if (!paidPlansOk) {
  console.warn("WARNING: Stripe price IDs are not fully configured — subscription checkout will fail for the affected plans until these are set in the Stripe Dashboard and here.\n");
}

if (!enterpriseBillingOk) {
  console.warn("WARNING: Enterprise Stripe price IDs are not fully configured — org subscription creation, billing cycle changes, and homeowner sponsorship seat billing will all fail at runtime until these are set.\n");
}

console.log("Environment check passed. See warnings above for anything non-blocking that still needs attention.\n");
