/**
 * GridGuide — API route auth helpers (Node.js runtime)
 * Provides ok/err response helpers, Zod validation, password helpers, and auth cookies.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

export function ok(data = {}, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function err(message, status = 400, details = null) {
  return NextResponse.json(
    { ok: false, error: message, ...(details && { details }) },
    { status }
  );
}

export async function parseBody(request, schema) {
  try {
    const raw = await request.json();
    const data = schema.parse(raw);
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e.errors || e.message };
  }
}

export function parseParams(request) {
  const { searchParams } = new URL(request.url);
  return Object.fromEntries(searchParams.entries());
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

export const loginSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1),
});

export const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
  password: z.string().min(8),
  phone: z.string().optional(),
  // ADMIN is intentionally excluded — nothing a caller submits at registration
  // should ever be able to self-assign platform admin access. The real
  // /api/auth/register route defines and enforces its own equivalent
  // restricted schema; this one is kept in sync as defense in depth in case
  // it is ever wired into a route directly.
  role: z.enum(["CONSUMER", "INSTALLER", "SELLER"]).optional().default("CONSUMER"),
  plan: z.enum(["HOMEOWNER_FREE", "HOMEOWNER_PLUS", "HOMEOWNER_PREMIUM"]).optional().default("HOMEOWNER_FREE"),
});

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  parts.push(`Path=${options.path || "/"}`);
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function setTokenCookies(response, tokens) {
  const headers = response.headers;
  headers.append("Set-Cookie", serializeCookie("access_token", tokens.accessToken, { maxAge: 15 * 60 }));
  headers.append("Set-Cookie", serializeCookie("refresh_token", tokens.refreshToken, { maxAge: 7 * 24 * 60 * 60 }));
  return response;
}

export function clearTokenCookies(response) {
  response.headers.append("Set-Cookie", serializeCookie("access_token", "", { maxAge: 0 }));
  response.headers.append("Set-Cookie", serializeCookie("refresh_token", "", { maxAge: 0 }));
  return response;
}
