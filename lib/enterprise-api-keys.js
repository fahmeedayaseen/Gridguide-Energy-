/**
 * Enterprise API-key authentication for machine integrations (meters, BMS,
 * DCIM platforms) that can't hold a 15-minute user session.
 *
 * Keys are created in the Enterprise portal (POST /api/enterprise/api-keys),
 * look like `gg_live_<48 hex>`, and only their SHA-256 hash is stored.
 * They're sent as `Authorization: Bearer gg_live_...` or `X-API-Key: gg_live_...`.
 *
 * middleware.js lets a gg_live_ key through ONLY on the routes listed in
 * API_KEY_ROUTES there; each of those handlers must call
 * resolveEnterpriseActor() (below), which verifies the key here.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "./db.js";
import { rateLimit } from "./redis.js";
import { authenticateRequest } from "./jwt.js";
import { requireEnterpriseRole, ROLE_RANK } from "./enterprise-permissions.js";

export const API_KEY_PREFIX = "gg_live_";
const KEY_PATTERN = /^gg_live_[0-9a-f]{48}$/;
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const RATE_LIMIT_PER_MINUTE = 120;

export function extractApiKey(request) {
  const header = request.headers.get("x-api-key");
  if (header) return header.trim();
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith(`Bearer ${API_KEY_PREFIX}`)) return auth.slice(7).trim();
  return null;
}

export function hashApiKey(rawKey) {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Verify an enterprise API key.
 * @returns {{ ok: true, org, key } | { ok: false, status, error }}
 */
export async function authenticateApiKey(rawKey) {
  if (!rawKey || !KEY_PATTERN.test(rawKey)) return { ok: false, status: 401, error: "Invalid API key" };

  const keyHash = hashApiKey(rawKey);
  const key = await prisma.enterpriseApiKey.findFirst({ where: { keyHash }, include: { org: true } });
  if (!key || !timingSafeEqual(Buffer.from(key.keyHash), Buffer.from(keyHash))) {
    return { ok: false, status: 401, error: "Invalid API key" };
  }
  if (key.revokedAt) return { ok: false, status: 401, error: "This API key has been revoked" };
  if (!key.org?.apiEnabled) return { ok: false, status: 403, error: "API access is not enabled for this organization" };

  const limit = await rateLimit(`apikey:${key.id}`, RATE_LIMIT_PER_MINUTE, 60);
  if (!limit.allowed) return { ok: false, status: 429, error: "Rate limit exceeded (120 requests per minute per key)" };

  if (!key.lastUsedAt || Date.now() - new Date(key.lastUsedAt).getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    await prisma.enterpriseApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { ok: true, org: key.org, key };
}

/**
 * Resolve who is calling an Enterprise route: a signed-in team member, or —
 * when `allowApiKey` is set — an integration using an API key.
 *
 * API keys act with Manager-level data access (read + write readings) and
 * never with Admin/Owner rights.
 *
 * @returns {{ error, status } | { org, role, actor: { userId, apiKeyId, label } }}
 */
export async function resolveEnterpriseActor(request, minRole, { allowApiKey = false } = {}) {
  const rawKey = extractApiKey(request);
  if (rawKey) {
    if (!allowApiKey) return { error: "API keys can't be used on this endpoint", status: 403 };
    if (ROLE_RANK[minRole] > ROLE_RANK.Manager) return { error: "API keys can't perform this action", status: 403 };
    const res = await authenticateApiKey(rawKey);
    if (!res.ok) return { error: res.error, status: res.status };
    return {
      org: res.org,
      role: "API_KEY",
      actor: { userId: null, apiKeyId: res.key.id, label: res.key.label || res.key.keyPrefix },
    };
  }

  const auth = await authenticateRequest(request);
  if (auth.error) return { error: auth.error, status: auth.status };
  const access = await requireEnterpriseRole(auth.user.id, minRole);
  if (!access.allowed) return { error: access.error, status: access.status };
  return { org: access.org, role: access.role, actor: { userId: auth.user.id, apiKeyId: null, label: null } };
}

/** Fields for logAudit() describing the actor. */
export function auditActor(ctx) {
  return { actorUserId: ctx.actor.userId, actorRole: ctx.role };
}

/** Extra audit metadata identifying an API-key caller (empty for users). */
export function auditActorMeta(ctx) {
  return ctx.actor.apiKeyId ? { apiKeyId: ctx.actor.apiKeyId, apiKeyLabel: ctx.actor.label } : {};
}
