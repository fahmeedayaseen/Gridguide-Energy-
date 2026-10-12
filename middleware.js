/**
 * GridGuide — Next.js Middleware
 *
 * Runs on the EDGE runtime — no Node.js APIs, no Prisma, no jsonwebtoken.
 * Uses the Web Crypto API (available on Edge) for JWT verification.
 *
 * This verifies the JWT signature and expiry without touching the database.
 * Logout revocation (Redis) and role checks are done inside each API route
 * using lib/jwt.js's authenticateRequest()/requireRole(), which run in the
 * Node.js serverless runtime and trust the x-user-* headers set below.
 *
 * SECURITY: x-user-id / x-user-role / x-user-email are trust boundaries.
 * Every API route handler treats these headers as verified identity. That is
 * only safe if this middleware (a) strips any client-supplied copies of these
 * headers on every request, and (b) only ever sets them itself, after a real
 * JWT signature check. Both are enforced below — never relax either one.
 */

import { NextResponse } from "next/server";

// Headers that must never be trusted if they arrive from the client directly.
// They are only meaningful when set by this middleware after JWT verification.
const IDENTITY_HEADERS = ["x-user-id", "x-user-role", "x-user-email"];

/**
 * Public API routes — do NOT require authentication.
 *
 * Each entry is method-scoped on purpose. Several of these paths also have
 * privileged verbs (e.g. POST /api/marketplace/products requires SELLER/ADMIN,
 * POST /api/geo/zip requires ADMIN) that must stay behind auth. Do not widen
 * an entry to "all methods" without checking the route handler first.
 *
 * `matchChildren: true` additionally allows exactly one extra path segment
 * (e.g. "/api/marketplace/products/abc123") — never deeper, and never for
 * segments that map to an action sub-route like "/apply".
 */
const PUBLIC_ROUTES = [
  { path: "/api/auth/login", methods: ["POST"] },
  { path: "/api/auth/register", methods: ["POST"] },
  { path: "/api/auth/forgot-password", methods: ["POST"] },
  { path: "/api/auth/reset-password", methods: ["POST"] },
  { path: "/api/payments/webhook", methods: ["POST"] }, // Stripe signature verified inside the handler

  // Vercel Cron triggers and partner (EnergyHub/Leap) webhooks don't carry a user
  // JWT — they authenticate via their own shared secret / HMAC signature, checked
  // inside each handler (see lib/secrets.js — fails closed in production if the
  // relevant secret is unset, it does NOT fall back to accepting the request).
  { path: "/api/cron", methods: ["GET", "POST"] },
  { path: "/api/cron/installer-commissions", methods: ["GET", "POST"] },
  // Vercel Cron calls these with GET and no user session. Without these
  // entries middleware returned 401 before the handler's CRON_SECRET check
  // ever ran, so the scheduled jobs in vercel.json never executed.
  { path: "/api/cron/process-delivery-jobs", methods: ["GET", "POST"] },
  { path: "/api/cron/invitation-campaigns", methods: ["GET", "POST"] },
  { path: "/api/cron/wallet-reconcile", methods: ["GET", "POST"] },
  { path: "/api/vpp/webhooks", methods: ["POST"], matchChildren: true },

  // OAuth callbacks — hit by an external redirect (UtilityAPI, Ecobee, Google
  // Nest, etc.), not a GridGuide session. These authenticate via their own
  // Redis-stored `state` token (verified inside the handler), not a user
  // JWT — a short-lived access token could plausibly expire during a long
  // OAuth consent flow, and middleware must not 401 the callback before it
  // even runs.
  { path: "/api/integrations/callback", methods: ["GET"] },
  { path: "/api/utility/connect/callback", methods: ["GET"] },
  { path: "/api/thermostat/connect/callback", methods: ["GET"] },

  // Public product catalog (browsing). Mutations (POST/PATCH/DELETE) stay authenticated.
  { path: "/api/marketplace/products", methods: ["GET"] },
  { path: "/api/marketplace/products", methods: ["GET"], matchChildren: true },

  // Public installer directory (browsing) + public review reads. Registering as an
  // installer and posting a review both require a real authenticated user and are NOT public.
  { path: "/api/installers", methods: ["GET"] },
  { path: "/api/installers/reviews", methods: ["GET"] },

  // Public rebate program listing. Submitting/looking up a claim requires auth.
  { path: "/api/rebates", methods: ["GET"] },

  // Public geo lookups used by signup/address forms. Admin bulk-seeding (POST /api/geo/zip)
  // stays authenticated.
  { path: "/api/geo/search", methods: ["GET"] },
  { path: "/api/geo/reverse", methods: ["GET"] },
  { path: "/api/geo/zip", methods: ["GET"] },
  { path: "/api/geo/utility-territory", methods: ["GET"] },
  { path: "/api/geo/installers", methods: ["GET"] },

  // Utility Intelligence Module — Phase 5 AI Utility Router. Read-only lookup by
  // address/zip, same trust level as the geo endpoints above.
  { path: "/api/utilities/router", methods: ["GET"] },
];

function isPublicRoute(pathname, method) {
  for (const route of PUBLIC_ROUTES) {
    if (route.methods && !route.methods.includes(method)) continue;

    if (pathname === route.path) return true;

    if (route.matchChildren) {
      const rest = pathname.slice(route.path.length);
      // Exactly one more non-empty path segment, nothing deeper (e.g. blocks
      // "/api/marketplace/products/abc/reviews" or "/api/rebates/apply").
      if (/^\/[^/]+$/.test(rest)) return true;
    }
  }
  return false;
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow all non-API routes (pages, static files, etc.)
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow CORS preflight requests before auth checks
  if (request.method === "OPTIONS") {
    return addCorsHeaders(new NextResponse(null, { status: 204 }), request);
  }

  // Always start from a header set with any client-supplied identity headers
  // removed, so a public route (or any future routing mistake) can never let
  // an unverified caller impersonate a user or role via raw request headers.
  const sanitizedHeaders = new Headers(request.headers);
  for (const h of IDENTITY_HEADERS) sanitizedHeaders.delete(h);

  // Public API routes — pass through with identity headers stripped, nothing set.
  if (isPublicRoute(pathname, request.method)) {
    const response = NextResponse.next({ request: { headers: sanitizedHeaders } });
    return addCorsHeaders(response, request);
  }

  // Extract token from Authorization header or cookie
  const authHeader = request.headers.get("authorization") || "";
  const cookieToken = request.cookies.get("access_token")?.value;
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : cookieToken;

  if (!token) {
    return jsonError("Authentication required", 401);
  }

  // Verify JWT using Web Crypto API (Edge-compatible — no jsonwebtoken)
  const valid = await verifyJwtEdge(token);
  if (!valid) {
    return jsonError("Invalid or expired token", 401);
  }

  // Set verified identity headers for route handlers. sanitizedHeaders already
  // has any client-supplied x-user-* stripped, so .set() here is the ONLY
  // place these headers can end up populated.
  sanitizedHeaders.set("x-user-id", valid.sub || "");
  sanitizedHeaders.set("x-user-role", valid.role || "CONSUMER");
  sanitizedHeaders.set("x-user-email", valid.email || "");

  const response = NextResponse.next({
    request: { headers: sanitizedHeaders },
  });

  return addCorsHeaders(response, request);
}

// ── Edge-compatible JWT verification (HS256) ──────────────────────────────────
async function verifyJwtEdge(token) {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Import the secret key
    const keyData = new TextEncoder().encode(secret);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Reconstruct the signing input
    const signingInput = `${headerB64}.${payloadB64}`;
    const signingBytes = new TextEncoder().encode(signingInput);

    // Decode the signature
    const signatureBytes = base64UrlDecode(signatureB64);

    // Verify signature
    const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, signingBytes);
    if (!valid) return null;

    // Decode payload
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadB64))
    );

    // Check expiry. Tokens without exp are rejected — every token GridGuide
    // issues has one, so a missing exp means it wasn't issued by us.
    if (!payload.exp || Date.now() / 1000 > payload.exp) return null;

    // Never accept a refresh token as an access token (relevant whenever
    // JWT_REFRESH_SECRET is unset and falls back to JWT_SECRET).
    if (payload.typ === "refresh") return null;

    // Only HS256 is accepted.
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
    if (header.alg !== "HS256") return null;

    return payload;
  } catch {
    return null;
  }
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLength);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function addCorsHeaders(response, request) {
  const origin = request.headers.get("origin") || "";
  const allowed = [
    "https://gridguide.ai",
    "https://gridguideenergy.com",
    "https://seller.gridguide.ai",
    "https://installer.gridguide.ai",
    "https://admin.gridguide.ai",
    "http://localhost:3000",
  ];

  if (allowed.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
