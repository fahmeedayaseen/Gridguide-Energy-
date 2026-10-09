import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.PAYOUT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const enc = await import("../lib/field-encryption.js");

test("round-trips bank details and never stores plaintext", () => {
  enc._resetKeyCacheForTests();
  const details = { routing: "021000021", account: "123456789", name: "Jane Smith" };
  const sealed = enc.encryptJson(details);
  assert.match(sealed, /^v1:/);
  assert.ok(!sealed.includes("123456789"));
  assert.deepEqual(enc.decryptJson(sealed), details);
});

test("uses a fresh IV every time", () => {
  enc._resetKeyCacheForTests();
  assert.notEqual(enc.encryptJson({ a: 1 }), enc.encryptJson({ a: 1 }));
});

test("detects tampering", () => {
  enc._resetKeyCacheForTests();
  const parts = enc.encryptJson({ account: "123456789" }).split(":");
  const data = Buffer.from(parts[3], "base64");
  data[0] ^= 0xff;
  parts[3] = data.toString("base64");
  assert.throws(() => enc.decryptJson(parts.join(":")));
});

test("rejects a wrong key", () => {
  enc._resetKeyCacheForTests();
  const sealed = enc.encryptJson({ x: 1 });
  process.env.PAYOUT_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  enc._resetKeyCacheForTests();
  assert.throws(() => enc.decryptJson(sealed));
});

test("rejects a malformed key", () => {
  process.env.PAYOUT_ENCRYPTION_KEY = "too-short";
  enc._resetKeyCacheForTests();
  assert.throws(() => enc.encryptJson({ x: 1 }), /32 bytes/);
  process.env.PAYOUT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  enc._resetKeyCacheForTests();
});
