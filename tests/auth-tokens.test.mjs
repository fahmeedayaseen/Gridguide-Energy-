// Run with: node --import ./tests/helpers/register-alias.mjs --test tests/auth-tokens.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET = "test-access-secret";
delete process.env.JWT_REFRESH_SECRET; // falls back to JWT_SECRET — the risky configuration
delete process.env.REDIS_URL;          // in-memory revocation store

const jwt = await import("../lib/jwt.js");
const { blacklistToken } = await import("../lib/redis.js");

const user = { id: "u1", email: "a@b.co", role: "CONSUMER", plan: "HOMEOWNER_FREE" };
function requestWith(token) {
  const headers = new Map([
    ["x-user-id", user.id], ["x-user-role", user.role], ["x-user-email", user.email],
    ["authorization", `Bearer ${token}`],
  ]);
  return { headers: { get: (h) => headers.get(h.toLowerCase()) ?? null } };
}

test("refresh token is never accepted as an access token (shared secret)", async () => {
  const { accessToken, refreshToken } = jwt.issueTokens(user);
  assert.ok(await jwt.verifyAccess(accessToken));
  assert.equal(await jwt.verifyAccess(refreshToken), null);
});

test("access token is never accepted as a refresh token", () => {
  const { accessToken, refreshToken } = jwt.issueTokens(user);
  assert.ok(jwt.verifyRefreshToken(refreshToken));
  assert.equal(jwt.verifyRefreshToken(accessToken), null);
});

test("re-signing a decoded payload does not carry over exp/typ", () => {
  const { refreshToken } = jwt.issueTokens(user);
  const decoded = jwt.verifyRefreshToken(refreshToken);
  const access = jwt.signAccessToken(decoded);
  const payload = jwt.decodeUnverified(access);
  assert.equal(payload.typ, "access");
  assert.ok(payload.exp - payload.iat <= 15 * 60);
});

test("logged-out access token is rejected on the next API request", async () => {
  const { accessToken } = jwt.issueTokens(user);
  const before = await jwt.authenticateRequest(requestWith(accessToken));
  assert.equal(before.error, null);

  await blacklistToken(accessToken, 900, jwt.decodeUnverified(accessToken).exp);

  const after = await jwt.authenticateRequest(requestWith(accessToken));
  assert.equal(after.status, 401);
});

test("requireRole also enforces revocation", async () => {
  const { accessToken } = jwt.issueTokens(user);
  await blacklistToken(accessToken, 900);
  const res = await jwt.requireRole(requestWith(accessToken), "CONSUMER");
  assert.equal(res.status, 401);
});
