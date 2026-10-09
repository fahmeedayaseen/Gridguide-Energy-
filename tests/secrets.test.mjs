import test from "node:test";
import assert from "node:assert/strict";

// lib/secrets.js reads NODE_ENV at import time, so import a fresh copy per scenario.
let n = 0;
async function load(env) {
  const saved = { ...process.env };
  for (const k of ["NODE_ENV", "CRON_SECRET", "ALLOW_INSECURE_DEV_SECRETS"]) delete process.env[k];
  Object.assign(process.env, env);
  const mod = await import(`../lib/secrets.js?case=${n++}`);
  return { mod, restore: () => { process.env = saved; } };
}
const req = (auth) => ({ headers: { get: (h) => (h.toLowerCase() === "authorization" ? auth : null) } });

test("cron: rejects when CRON_SECRET is unset, even outside production", async () => {
  const { mod, restore } = await load({ NODE_ENV: "development" });
  assert.equal(mod.verifyCronRequest(req("Bearer undefined")), false);
  assert.equal(mod.verifyCronRequest(req(null)), false);
  restore();
});

test("cron: accepts only the exact bearer secret", async () => {
  const { mod, restore } = await load({ NODE_ENV: "production", CRON_SECRET: "s3cret" });
  assert.equal(mod.verifyCronRequest(req("Bearer s3cret")), true);
  assert.equal(mod.verifyCronRequest(req("Bearer s3cre")), false);
  assert.equal(mod.verifyCronRequest(req("s3cret")), false);
  restore();
});

test("dev bypass works only when explicitly enabled and never in production", async () => {
  let c = await load({ NODE_ENV: "development", ALLOW_INSECURE_DEV_SECRETS: "true" });
  assert.equal(c.mod.insecureDevBypassEnabled(), true);
  assert.equal(c.mod.verifyCronRequest(req(null)), true);
  c.restore();

  c = await load({ NODE_ENV: "production", ALLOW_INSECURE_DEV_SECRETS: "true" });
  assert.equal(c.mod.insecureDevBypassEnabled(), false);
  assert.equal(c.mod.verifyCronRequest(req(null)), false);
  c.restore();
});
