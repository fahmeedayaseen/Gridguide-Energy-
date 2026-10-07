/**
 * GET /api/admin/system-status — which third-party integrations are
 * configured, without ever exposing the actual secret values.
 *
 * There's no distinct "platform settings" concept in this schema beyond
 * what AdminRates (PlatformConfig) already covers — building a fake
 * settings-toggle page on top of nothing would just be padding. This is
 * the genuinely useful, real thing an admin "Settings" page can show:
 * the same boolean presence checks scripts/verify-env.js does at deploy
 * time, exposed as a live admin-facing status grid.
 */
import { ok } from "@/lib/auth.js";
import { err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

const isSet = (v) => !!v && !/^change-this|\.\.\.$/.test(v);

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  return ok({
    integrations: [
      { name: "Database",        configured: isSet(process.env.DATABASE_URL) },
      { name: "Redis",           configured: isSet(process.env.REDIS_URL), note: process.env.SKIP_REDIS === "true" ? "In-memory fallback active" : null },
      { name: "Stripe",          configured: isSet(process.env.STRIPE_SECRET_KEY) && isSet(process.env.STRIPE_WEBHOOK_SECRET) },
      { name: "Stripe Price IDs",configured: [process.env.STRIPE_PRICE_CONSUMER_PRO, process.env.STRIPE_PRICE_CONSUMER_ENTERPRISE, process.env.STRIPE_PRICE_SELLER_PRO, process.env.STRIPE_PRICE_INSTALLER_PRO, process.env.STRIPE_PRICE_INSTALLER_ENTERPRISE].every(isSet) },
      { name: "SendGrid (email)",configured: isSet(process.env.SENDGRID_API_KEY) },
      { name: "Twilio (SMS)",    configured: isSet(process.env.TWILIO_ACCOUNT_SID) && isSet(process.env.TWILIO_AUTH_TOKEN) },
      { name: "Anthropic (AI)",  configured: isSet(process.env.ANTHROPIC_API_KEY) },
      { name: "AWS S3 (uploads)",configured: isSet(process.env.AWS_ACCESS_KEY_ID) && isSet(process.env.AWS_S3_BUCKET) },
      { name: "UtilityAPI",      configured: isSet(process.env.UTILITYAPI_KEY) },
      { name: "Google Maps",     configured: isSet(process.env.GOOGLE_MAPS_API_KEY) },
      { name: "Mapbox",          configured: isSet(process.env.NEXT_PUBLIC_MAPBOX_TOKEN) },
      { name: "Sentry",          configured: isSet(process.env.SENTRY_DSN) },
      { name: "Cron auth",       configured: isSet(process.env.CRON_SECRET) },
    ],
    environment: process.env.NODE_ENV || "development",
  });
}
