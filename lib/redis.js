import { createClient } from "redis";
import { createHash } from "node:crypto";

const globalForRedis = globalThis;

class MemoryRedis {
  constructor() { this.store = new Map(); this.zsets = new Map(); }
  _expired(key) { const item = this.store.get(key); if (item?.expires && item.expires < Date.now()) { this.store.delete(key); return true; } return false; }
  async get(key) { if (this._expired(key)) return null; return this.store.get(key)?.value ?? null; }
  async setEx(key, ttl, value) { this.store.set(key, { value, expires: Date.now() + ttl * 1000 }); }
  async set(key, value, options = {}) { this.store.set(key, { value, expires: options.EX ? Date.now() + options.EX * 1000 : undefined }); return "OK"; }
  async del(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) this.store.delete(k); }
  async keys(pattern) { const prefix = pattern.replace("*", ""); return [...this.store.keys()].filter((k) => k.startsWith(prefix)); }
  async incr(key) { const current = Number(await this.get(key) || 0) + 1; await this.set(key, String(current)); return current; }
  async expire(key, ttl) { const item = this.store.get(key); if (item) item.expires = Date.now() + ttl * 1000; }
  async zRemRangeByScore(key, _min, max) { const z = this.zsets.get(key) || []; this.zsets.set(key, z.filter((x) => x.score > Number(max))); }
  async zCard(key) { return (this.zsets.get(key) || []).length; }
  async zRange(key, start, stop) { return (this.zsets.get(key) || []).sort((a,b)=>a.score-b.score).slice(start, stop + 1).map((x)=>x.value); }
  async zAdd(key, entry) { const z = this.zsets.get(key) || []; z.push(entry); this.zsets.set(key, z); }
  async lPush(key, value) { const list = JSON.parse((await this.get(key)) || "[]"); list.unshift(value); await this.set(key, JSON.stringify(list)); }
}

let client = globalForRedis.redis;

if (!client) {
  const useMemory = !process.env.REDIS_URL || process.env.SKIP_REDIS === "true";
  if (useMemory) {
    client = new MemoryRedis();
  } else {
    try {
      client = createClient({ url: process.env.REDIS_URL });
      client.on("error", (err) => console.error("[Redis]", err));
      await client.connect();
    } catch (e) {
      console.warn("[Redis] Falling back to in-memory cache:", e.message);
      client = new MemoryRedis();
    }
  }
  if (process.env.NODE_ENV !== "production") globalForRedis.redis = client;
}

export const redis = client;

export async function rateLimit(key, max = 10, windowSec = 60) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const redisKey = `rl:${key}`;
  await redis.zRemRangeByScore(redisKey, "-inf", now - windowMs);
  const count = await redis.zCard(redisKey);
  if (count >= max) {
    const oldest = await redis.zRange(redisKey, 0, 0);
    const resetAt = oldest[0] ? parseInt(oldest[0]) + windowMs : now + windowMs;
    return { allowed: false, remaining: 0, resetAt };
  }
  await redis.zAdd(redisKey, { score: now, value: String(now) });
  await redis.expire(redisKey, windowSec);
  return { allowed: true, remaining: max - count - 1, resetAt: now + windowMs };
}

export async function cacheGet(key) {
  const val = await redis.get(`cache:${key}`);
  return val ? JSON.parse(val) : null;
}

export async function cacheSet(key, value, ttlSec = 300) {
  await redis.setEx(`cache:${key}`, ttlSec, JSON.stringify(value));
}

export async function cacheDel(key) { await redis.del(`cache:${key}`); }

export async function cacheDelPattern(pattern) {
  const keys = await redis.keys(`cache:${pattern}`);
  if (keys.length) await redis.del(keys);
}

// ── Token revocation (logout) ────────────────────────────────────────────────
// Keys are a SHA-256 of the token rather than the raw JWT, so revoked tokens
// are never stored in Redis in usable form and keys stay a fixed length.
//
// IMPORTANT: revocation only works across server instances when REDIS_URL
// points at a real shared Redis. The in-memory fallback above is per-process,
// so on a multi-instance deploy (Vercel) a token revoked on one instance would
// still be accepted on another. scripts/verify-env.js therefore treats
// REDIS_URL as required in production.
function blacklistKey(token) {
  return `blacklist:${createHash("sha256").update(token).digest("hex")}`;
}

/**
 * Revoke a token until it would have expired anyway.
 * `exp` is the JWT's exp claim (seconds). Falls back to `fallbackTtlSec`
 * when the token can't be decoded.
 */
export async function blacklistToken(token, fallbackTtlSec = 900, exp = null) {
  if (!token) return;
  let ttl = fallbackTtlSec;
  if (exp) ttl = Math.ceil(exp - Date.now() / 1000);
  if (ttl <= 0) return; // already expired — nothing to revoke
  await redis.setEx(blacklistKey(token), ttl, "1");
}

export async function isBlacklisted(token) {
  if (!token) return false;
  return !!(await redis.get(blacklistKey(token)));
}

export const usingMemoryRedis = client instanceof MemoryRedis;
if (usingMemoryRedis && process.env.NODE_ENV === "production") {
  console.error(
    "[Redis] Running on the in-memory fallback in production. Logout token " +
    "revocation and rate limits will NOT be shared across instances. Set REDIS_URL."
  );
}
export async function cacheThermostatState(userId, state) { await redis.setEx(`thermo:${userId}`, 60, JSON.stringify(state)); }
export async function getThermostatState(userId) { const val = await redis.get(`thermo:${userId}`); return val ? JSON.parse(val) : null; }
