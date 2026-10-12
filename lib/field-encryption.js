/**
 * Application-level encryption for sensitive fields stored in Postgres
 * (bank routing/account numbers on withdrawals).
 *
 * AES-256-GCM with a random 12-byte IV per value. Output format:
 *   v1:<iv base64>:<auth tag base64>:<ciphertext base64>
 *
 * Key: PAYOUT_ENCRYPTION_KEY — 32 random bytes, base64 or hex encoded.
 * Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * In production a missing or malformed key throws (fail closed): we never
 * write bank details in plaintext and never fall back to a known key.
 * In development a fixed dev-only key is used with a warning.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const VERSION = "v1";
const IS_PROD = (process.env.NODE_ENV || "development") === "production";

function decodeKey(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  try {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === 32) return buf;
  } catch { /* fall through */ }
  return null;
}

let cachedKey = null;

export function getEncryptionKey() {
  if (cachedKey) return cachedKey;
  const key = decodeKey(process.env.PAYOUT_ENCRYPTION_KEY);
  if (key) {
    cachedKey = key;
    return key;
  }
  if (process.env.PAYOUT_ENCRYPTION_KEY) {
    throw new Error("[GridGuide] PAYOUT_ENCRYPTION_KEY must be 32 bytes, base64 or hex encoded.");
  }
  if (IS_PROD) {
    throw new Error(
      "[GridGuide] Missing PAYOUT_ENCRYPTION_KEY in production. Withdrawals that carry " +
      "bank details cannot be accepted without it."
    );
  }
  console.warn("[GridGuide] PAYOUT_ENCRYPTION_KEY not set — using an insecure development-only key.");
  cachedKey = createHash("sha256").update("gridguide-dev-only-payout-key").digest();
  return cachedKey;
}

/** Encrypt a JSON-serializable value. */
export function encryptJson(value) {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypt a value produced by encryptJson. Throws if tampered with or the key is wrong. */
export function decryptJson(payload) {
  if (!payload) return null;
  const [version, ivB64, tagB64, dataB64] = String(payload).split(":");
  if (version !== VERSION || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error("Unrecognized encrypted payload format");
  }
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

/** Test hook: forget the cached key so a changed env var is picked up. */
export function _resetKeyCacheForTests() {
  cachedKey = null;
}
