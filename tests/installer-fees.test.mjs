// Run with: node --import ./tests/helpers/register-alias.mjs --test tests/installer-fees.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const cfg = await import("../lib/platform-config.js");

test("default plan rates are Free 10% · Pro 7% · Enterprise 5%", () => {
  assert.deepEqual({ ...cfg.INSTALLER_SUCCESS_FEE_DEFAULTS }, { FREE: 0.10, PRO: 0.07, ENTERPRISE: 0.05 });
});

test("fee math rounds to cents and is zero for self-sourced work", () => {
  assert.equal(cfg.computeInstallerSuccessFee(20000, 0.10), 2000);
  assert.equal(cfg.computeInstallerSuccessFee(12345.67, 0.07), 864.2);
  assert.equal(cfg.computeInstallerSuccessFee(20000, 0.10, { gridGuideSourced: false }), 0);
  assert.equal(cfg.computeInstallerSuccessFee(-5, 0.10), 0);
  assert.equal(cfg.computeInstallerSuccessFee("abc", 0.10), 0);
});

test("legacy plan names map to the right tier", async () => {
  const rates = await cfg.getInstallerSuccessFeeRates();
  assert.equal(await cfg.getInstallerSuccessFeeRate("BASIC"), rates.FREE);
  assert.equal(await cfg.getInstallerSuccessFeeRate("INSTALLER_ENTERPRISE"), rates.ENTERPRISE);
  assert.equal(await cfg.getInstallerSuccessFeeRate(undefined), rates.FREE);
});

// Guard against the bug coming back: no hardcoded success-fee tables outside platform-config.
test("no other server file hardcodes an installer success-fee table", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".js") && !p.endsWith("platform-config.js")) {
        const src = readFileSync(p, "utf8");
        if (/(SUCCESS_FEES?|successFeeRates|leadSuccessFee)\s*[:=]\s*\{/.test(src) || /leadSuccessFee:\s*0\.\d/.test(src)) offenders.push(p);
      }
    }
  };
  walk(new URL("../lib", import.meta.url).pathname);
  walk(new URL("../app/api", import.meta.url).pathname);
  assert.deepEqual(offenders, []);
});
