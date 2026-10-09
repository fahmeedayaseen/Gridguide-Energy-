/**
 * GridGuide — JWT utilities (Node.js runtime only)
 */

import jwt from "jsonwebtoken";
import { isBlacklisted } from "./redis.js";

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

/**
 * Resolve a signing secret from the environment.
 *
 * In production, a missing secret throws immediately at module load (fail
 * fast, loud, at boot) rather than silently falling back to a hardcoded
 * dev value. That hardcoded value is checked into source control history,
 * so using it in production would let anyone who has ever seen this repo
 * forge valid tokens. Middleware.js already fails closed (401) when
 * JWT_SECRET is unset on the Edge runtime; this keeps the Node.js runtime
 * consistent with that instead of quietly signing tokens with a different,
 * insecure secret.
 */
function resolveSecret(varName, { fallbackEnvVar, devDefault } = {}) {
  const direct = process.env[varName];
  if (direct) return direct;

  if (fallbackEnvVar && process.env[fallbackEnvVar]) return process.env[fallbackEnvVar];

  if (IS_PROD) {
    throw new Error(
      `[GridGuide] Missing required environment variable ${varName}. Set it in the ` +
      `production environment before starting the server — authentication cannot run without it.`
    );
  }

  console.warn(
    `[GridGuide] ${varName} is not set. Using an insecure development-only default. ` +
    `This must never happen in a production deployment.`
  );
  return devDefault;
}

const ACCESS_SECRET = resolveSecret("JWT_SECRET", { devDefault: "dev-access-secret-change-me" });
const REFRESH_SECRET = resolveSecret("JWT_REFRESH_SECRET", {
  fallbackEnvVar: "JWT_SECRET",
  devDefault: "dev-refresh-secret-change-me",
});
const ACCESS_TTL = "15m";
const REFRESH_TTL = "7d";

// Every token carries a `typ` claim. JWT_REFRESH_SECRET falls back to
// JWT_SECRET when unset, and middleware.js verifies with JWT_SECRET — so
// without this claim a 7-day refresh token would be accepted anywhere an
// access token is. Access paths reject typ "refresh"; the refresh route
// requires it.
function stripReserved(payload) {
  // Re-signing a decoded payload must not carry over the old exp/iat/typ.
  const { exp, iat, nbf, typ, ...rest } = payload || {};
  return rest;
}

export function signAccess(payload) {
  return jwt.sign({ ...stripReserved(payload), typ: "access" }, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

export function signRefresh(payload) {
  return jwt.sign({ ...stripReserved(payload), typ: "refresh" }, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

export function issueTokens(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    plan: user.plan,
  };
  return {
    accessToken: signAccess(payload),
    refreshToken: signRefresh(payload),
  };
}

export const signAccessToken = signAccess;
export const signRefreshToken = signRefresh;

export async function verifyAccess(token) {
  try {
    const payload = jwt.verify(token, ACCESS_SECRET);
    if (payload.typ === "refresh") return null;
    if (await isBlacklisted(token)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifyRefresh(token) {
  return verifyRefreshToken(token);
}

export function verifyRefreshToken(token) {
  try {
    const payload = jwt.verify(token, REFRESH_SECRET);
    if (payload.typ !== "refresh") return null;
    return payload;
  } catch {
    return null;
  }
}

/** Decode without verifying — only for reading `exp` on a token we're revoking. */
export function decodeUnverified(token) {
  try {
    return jwt.decode(token) || null;
  } catch {
    return null;
  }
}

function readCookie(request, name) {
  const cookies = request.headers.get("cookie") || "";
  const raw = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** The access token for this request — same precedence as middleware.js (Bearer header, then cookie). */
export function extractBearer(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  return readCookie(request, "access_token");
}

export function extractRefreshToken(request) {
  return readCookie(request, "refresh_token");
}

// If Redis is unreachable we can't check revocation. Failing closed would
// log every user out during a Redis outage; failing open means a logged-out
// token keeps working for at most its remaining 15 minutes during that
// outage. Default is open (with a loud error); set
// AUTH_REVOCATION_FAIL_CLOSED=true to make Redis a hard dependency instead.
const REVOCATION_FAIL_CLOSED = process.env.AUTH_REVOCATION_FAIL_CLOSED === "true";

/**
 * Resolve the authenticated user for an API route.
 *
 * middleware.js (Edge) has already verified the JWT signature, expiry and
 * token type and set the x-user-* headers. The Edge runtime can't reach
 * Redis, so the logout revocation check happens here, on the Node runtime,
 * for every route that uses authenticateRequest / requireRole / requireAuth.
 */
export async function authenticateRequest(request) {
  const userId = request.headers.get("x-user-id");
  const role = request.headers.get("x-user-role") || "CONSUMER";
  const email = request.headers.get("x-user-email") || "";
  if (!userId) return { error: "Authentication required", status: 401 };

  const token = extractBearer(request);
  if (!token) return { error: "Authentication required", status: 401 };
  try {
    if (await isBlacklisted(token)) {
      return { error: "Session has ended. Please sign in again.", status: 401 };
    }
  } catch (e) {
    console.error("[auth] Token revocation check failed:", e?.message || e);
    if (REVOCATION_FAIL_CLOSED) {
      return { error: "Authentication temporarily unavailable", status: 503 };
    }
  }

  return { user: { id: userId, role, email }, error: null };
}

// Backward-compatible name used by the partner-invitation acceptance route.
// Authentication is already enforced by middleware-provided identity headers.
export const requireAuth = authenticateRequest;

/**
 * Require the authenticated user to have one of the given roles.
 *
 * Accepts either multiple role arguments — requireRole(request, "ADMIN", "CONSUMER") —
 * or a single array — requireRole(request, ["ADMIN", "CONSUMER"]). Previously this only
 * accepted a single `role` parameter, so calls like requireRole(request, "SELLER", "ADMIN")
 * silently dropped "ADMIN" and blocked legitimate admins from creating marketplace
 * products, and requireRole(request, "ADMIN", "CONSUMER") blocked legitimate consumers
 * from creating installer leads.
 */
export async function requireRole(request, ...roles) {
  const auth = await authenticateRequest(request);
  if (auth.error) return auth;
  const flatRoles = roles.flat();
  if (!flatRoles.includes(auth.user.role)) {
    return { error: `${flatRoles.join(" or ")} access required`, status: 403 };
  }
  return auth;
}
