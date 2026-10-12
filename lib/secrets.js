/**
 * Shared secret-resolution helpers for anything that authenticates with a
 * shared secret rather than a per-user JWT: cron triggers, partner webhooks.
 *
 * FAIL CLOSED EVERYWHERE (Audit §5 M1). The previous version only failed
 * closed when NODE_ENV === "production". A staging or preview host running
 * with NODE_ENV=development (common for Docker/dev-mode deploys) and no
 * secret configured would accept unsigned VPP settlement webhooks and
 * unauthenticated payout cron calls from anyone on the internet.
 *
 * Now a missing secret means "reject", unless a developer explicitly opts in
 * on their own machine with ALLOW_INSECURE_DEV_SECRETS=true — and that opt-in
 * is ignored whenever NODE_ENV is production.
 */
import { timingSafeEqual } from "node:crypto";

const IS_PROD = (process.env.NODE_ENV || "development") === "production";

/** True only for a local developer who has explicitly opted out of secret checks. */
export function insecureDevBypassEnabled() {
  return !IS_PROD && process.env.ALLOW_INSECURE_DEV_SECRETS === "true";
}

/**
 * @param {string} varName - the environment variable name
 * @returns {string|null} the secret, or null ONLY when the local dev bypass is on
 * @throws when the secret is unset and the bypass is not enabled. Callers must
 *   treat a throw as "reject the request", never as "skip verification".
 */
export function requireSecret(varName) {
  const value = process.env[varName];
  if (value) return value;

  if (insecureDevBypassEnabled()) {
    console.warn(`[GridGuide] ${varName} is not set — check bypassed because ALLOW_INSECURE_DEV_SECRETS=true. Never set that on a deployed environment.`);
    return null;
  }

  throw new Error(
    `[GridGuide] Missing required environment variable ${varName}. ` +
    `This endpoint authenticates via a shared secret and rejects all requests without it.`
  );
}

/** Constant-time string comparison. */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ""));
  const bb = Buffer.from(String(b ?? ""));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a cron/internal call carries `Authorization: Bearer $CRON_SECRET`.
 * Vercel Cron sends exactly this header. Returns false (reject) when the
 * secret is unset, unless the local dev bypass is on.
 */
export function verifyCronRequest(request) {
  let secret;
  try {
    secret = requireSecret("CRON_SECRET");
  } catch (e) {
    console.error(e.message);
    return false;
  }
  if (secret === null) return true; // explicit local dev bypass only
  return safeEqual(request.headers.get("authorization") || "", `Bearer ${secret}`);
}

export { IS_PROD };
