/**
 * Shared secret-resolution helper — fail fast and loud in production if a
 * required secret is missing, instead of silently degrading to an insecure
 * "skip verification" fallback. Used by anything that authenticates via a
 * shared secret rather than a per-user JWT: cron triggers, partner webhooks.
 *
 * This mirrors the pattern already used for JWT_SECRET in lib/jwt.js —
 * kept as a separate small module so route handlers that need a secret
 * (not necessarily JWT-related) can reuse the same fail-fast behavior
 * without importing the whole auth stack.
 */
const IS_PROD = (process.env.NODE_ENV || "development") === "production";

/**
 * @param {string} varName - the environment variable name
 * @returns {string|null} the secret value, or null if unset and NOT production
 * @throws in production if the variable is unset — callers should let this
 *   throw during route initialization/module load where possible, or catch
 *   it and return a 500 rather than treating "no secret" as "no verification needed".
 */
export function requireSecret(varName) {
  const value = process.env[varName];
  if (value) return value;

  if (IS_PROD) {
    throw new Error(
      `[GridGuide] Missing required environment variable ${varName} in production. ` +
      `This endpoint authenticates via a shared secret and cannot safely run without it.`
    );
  }

  console.warn(`[GridGuide] ${varName} is not set — this endpoint's signature/secret check is disabled in development only. This must never happen in production.`);
  return null;
}

export { IS_PROD };
