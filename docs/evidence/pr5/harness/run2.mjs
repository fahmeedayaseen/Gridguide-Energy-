import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const srv = createServer((req, res) => { const u = req.url.split("?")[0]; const f = u === "/" ? "index2.html" : u.slice(1); try { res.end(readFileSync(f)); } catch { res.statusCode = 404; res.end(); } }).listen(4790);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) process.exitCode = 1; };
const text = () => page.locator("body").innerText();
const field = (label) => page.locator("label", { hasText: label }).locator("input,select,textarea").first();
const tab = async (name) => { await page.click(`button:text-is("${name}")`); await page.waitForTimeout(200); };
const lastCall = (m, frag) => page.evaluate(([m, f]) => window.__calls.filter((c) => c.m === m && c.path.includes(f)).pop(), [m, frag]);

await page.goto("http://localhost:4790/");
await page.waitForSelector("text=Accountability Snapshot");
let t = await text();
check("vendor-neutral title", t.includes("Data Center Energy & Water Accountability") && t.includes("nuclear"));
check("geothermal stays a featured card", t.includes("Featured Resource · Geothermal"));
check("water claim UNVERIFIED (discharge missing)", /Water claims\s*UNVERIFIED/.test(t));
check("water saved / recycled share flagged UNVERIFIED", t.includes("UNVERIFIED"));
check("overdue milestone counted", /Overdue permits & milestones\s*1/.test(t));
await page.screenshot({ path: "p1-overview.png", fullPage: true });

await tab("Portfolio");
t = await text();
check("resource mix lists geothermal (featured), wind and gas microgrid", t.includes("★ featured") && t.includes("Wind") && t.includes("Natural gas"));
check("delivery vs contract shows geothermal delivered %", /Geothermal PPA\s*Geothermal\s*1\s*12,000/.test(t));
check("wind with no deliveries shows dashes, not 0%", /Wind PPA\s*Wind\s*—/.test(t));
await page.screenshot({ path: "p2-portfolio.png", fullPage: true });

await tab("Contracts");
await field("Agreement name").fill("SMR offtake");
await field("Resource").selectOption("NUCLEAR");
await field("Contract type").selectOption("CAPACITY");
await field("Seller/developer").fill("Nuke Co");
await field("Contract MW").fill("300");
await field("Firm capacity MW").fill("280");
await field("Upstream water gal/MWh").fill("672");
await page.click("button:has-text('Add Contract')"); await page.waitForTimeout(200);
let c = await lastCall("POST", "/contracts");
check("contract POST carries resource/contract type, firm MW, water intensity", c?.body.resourceType === "NUCLEAR" && c.body.contractType === "CAPACITY" && c.body.firmCapacityMw === "280" && c.body.waterIntensityGalPerMwh === "672");
// Record a delivery
await page.locator("label", { hasText: "Contract *" }).locator("select").selectOption("c2");
await field("Delivered MWh").fill("25000");
await page.click("button:has-text('Record Delivery')"); await page.waitForTimeout(200);
c = await lastCall("POST", "/deliveries");
check("delivery POST defaults end to next month (exclusive)", c?.body.contractId === "c2" && c.body.deliveredMwh === "25000" && /T00:00:00.000Z$/.test(c.body.periodEnd) && c.body.periodEnd > c.body.periodStart);
await page.screenshot({ path: "p3-contracts.png", fullPage: true });

await tab("Assets");
await field("Asset name").fill("Battery 1");
await field("Asset type").selectOption("BATTERY");
await page.locator("label", { hasText: "private microgrid" }).locator("input").check();
await field("Accredited firm capacity").fill("20000");
await page.click("button:has-text('Add Asset')"); await page.waitForTimeout(200);
c = await lastCall("POST", "/assets");
check("asset POST: microgrid true + firm capacity", c?.body.microgrid === true && c.body.firmCapacityKw === "20000");

await tab("Load & Reserve");
t = await text();
check("reserve margin computed from firm sources (19 + 55 MW)", t.includes("74 MW"));
check("build-out shortfall explained", t.includes("more firm capacity is needed"));
check("ramp table shows planned future months", t.includes("(planned)") && t.includes("Peak operation"));
check("wind contract without firm MW listed as not counted", t.includes("Not counted (no firm capacity entered): Wind PPA"));
await field("Effective from").fill("2027-06-01");
await field("Planned average load MW").fill("90");
await page.click("button:has-text('Add Step')"); await page.waitForTimeout(200);
c = await lastCall("POST", "/ramp-steps");
check("ramp step POST", c?.body.propertyId === "p1" && c.body.effectiveDate === "2027-06-01T00:00:00.000Z" && c.body.plannedLoadMw === "90");
await page.locator("label", { hasText: "Required reserve margin" }).locator("input").fill("20");
await page.locator("button:text-is('Save')").first().click(); await page.waitForTimeout(200);
c = await lastCall("PATCH", "/properties/p1");
check("site reserve requirement PATCH", c?.body.requiredReserveMarginPct === "20");
check("meters listed with preferred settlement badge", (await text()).includes("Utility revenue meter") && (await text()).toUpperCase().includes("PREFERRED SETTLEMENT"));
check("ramp shows load data status from meters", (await text()).toUpperCase().includes("COMPLETE") || (await text()).toUpperCase().includes("PARTIAL"));
await page.click("button:has-text('Add meter')");
await field("Meter name").fill("Second main");
await page.locator("label", { hasText: "Effective from" }).locator("input").last().fill("2026-01-01");
await page.locator("label", { hasText: "Preferred settlement meter" }).locator("input").check();
await page.click("button:has-text('Add Meter')"); await page.waitForTimeout(250);
check("second preferred settlement meter rejected with the reason", (await text()).includes("already the preferred settlement meter"));
await page.screenshot({ path: "p4-load.png", fullPage: true });

await tab("Permits");
t = await text();
check("overdue permit flagged", t.includes("overdue"));
await field("Title").fill("Water rights permit");
await field("Category").selectOption("WATER_RIGHTS");
await field("Due").fill("2026-12-01");
await page.click("button:has-text('Add Milestone')"); await page.waitForTimeout(200);
c = await lastCall("POST", "/milestones");
check("milestone POST", c?.body.category === "WATER_RIGHTS" && c.body.dueDate === "2026-12-01T00:00:00.000Z");
await page.locator("button:has-text('Edit')").first().click();
await field("Status").selectOption("APPROVED");
await page.click("button:has-text('Save Changes')"); await page.waitForTimeout(200);
c = await lastCall("PATCH", "/milestones/");
check("milestone PATCH status", c?.body.status === "APPROVED");
await page.screenshot({ path: "p5-permits.png", fullPage: true });

await tab("Costs");
t = await text();
check("who-pays summary: 80% customer", t.includes("(80%)") && t.includes("(20%)"));
await field("Description").fill("Generation interconnection");
await field("Total cost").fill("500000");
await field("Customer share").fill("400000");
await field("Ratepayer share").fill("200000");
check("shares over total blocked in UI", (await text()).includes("Shares add up to more than the total cost") && await page.locator("button:has-text('Add Cost Item')").isDisabled());
await field("Ratepayer share").fill("100000");
await page.click("button:has-text('Add Cost Item')"); await page.waitForTimeout(200);
c = await lastCall("POST", "/cost-allocations");
check("cost allocation POST", c?.body.totalCost === "500000" && c.body.customerShare === "400000");
await page.screenshot({ path: "p6-costs.png", fullPage: true });

await tab("Water");
t = await text();
check("verification banner: UNVERIFIED + MISSING_MEASUREMENTS naming discharge", t.includes("Not verified") && t.includes("MISSING_MEASUREMENTS") && t.includes("Missing: water discharged"));
check("formula version shown (provenance)", t.includes("formula water-balance-v2"));
check("water panel separates reclaimed imported from on-site recycling", t.includes("Reclaimed water imported") && t.includes("Water recycled on site (internal loop)"));
check("upstream water from geothermal intensity (12,000 MWh × 10)", t.includes("120,000 gal"));
check("grid energy without intensity reported as not counted", /without one \(not counted\)\s*[\d,.]+ MWh/.test(t));
await page.locator("label", { hasText: "Grid water intensity" }).locator("input").fill("450");
await page.locator("label", { hasText: "Intensity source" }).locator("input").fill("Utility disclosure 2025");
await page.locator("button:text-is('Save')").first().click(); await page.waitForTimeout(200);
c = await lastCall("PATCH", "/properties/p1");
check("grid intensity PATCH with source", c?.body.gridWaterIntensityGalPerMwh === "450" && c.body.gridWaterIntensitySource === "Utility disclosure 2025");
await page.screenshot({ path: "p7-water.png", fullPage: true });

await tab("Readings");
check("readings form has discharge, reclaimed-imported and storage fields", (await page.locator("label", { hasText: "Water discharged gal" }).count()) === 1 && (await page.locator("label", { hasText: "Reclaimed water imported gal" }).count()) === 1 && (await page.locator("label", { hasText: "Storage change gal" }).count()) === 1);
await field("Property *").selectOption("p1");
await page.locator("label", { hasText: /^Meter/ }).locator("select").selectOption("mt1");
for (const [l, v] of [["Potable water withdrawn", "1000"], ["Reclaimed water imported gal", "50"], ["Water consumed gal", "700"], ["Water discharged gal", "290"], ["Water recycled on site gal", "300"], ["Storage change gal", "-20"]]) await field(l).fill(v);
await page.click("button:has-text('Save Reading')"); await page.waitForTimeout(300);
c = await lastCall("POST", "/readings");
check("reading POST includes discharge, imported reclaimed, negative storage and meter", c?.body.waterDischargedGallons === "290" && c.body.waterReclaimedImportedGallons === "50" && c.body.waterStorageChangeGallons === "-20" && c.body.meterId === "mt1");

// Water status moves through the tiers as data changes (refetch by toggling the site filter).
const refetchWater = async () => { await page.selectOption('select[aria-label="Property"]', "p1"); await page.waitForTimeout(150); await page.selectOption('select[aria-label="Property"]', ""); await page.waitForTimeout(250); await tab("Water"); };
await page.evaluate(() => { window.__db.readings.find((r) => r.id === "r1").waterDischargedGallons = 300; }); // in 2050 / out 1970 → 3.9%
await refetchWater();
t = await text();
check("complete, balanced water data → VERIFIED (no UNVERIFIED tags)", t.includes("Verified — WUE") && !t.includes("UNVERIFIED"));
await page.evaluate(() => { window.__db.readings.find((r) => r.id === "r1").waterDischargedGallons = 230; }); // out 1900 → 7.3%
await refetchWater();
t = await text();
check("7.3% variance → REVIEW with review flags", t.includes("Needs review") && t.includes("BALANCE_NEEDS_REVIEW") && /Recycled water share\s*[\d.]+% REVIEW/.test(t));
await page.screenshot({ path: "p9-water-review.png", fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
for (const n of ["Portfolio", "Load & Reserve", "Costs", "Water"]) { await tab(n); }
check("mobile: no horizontal page overflow", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await page.screenshot({ path: "p8-mobile.png", fullPage: true });

// Interval-split rule: a site whose main meter was swapped mid-month and that only sent a monthly
// total can't be split at the meters' effective dates → ESTIMATED with the assumption disclosed.
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto("http://localhost:4790/?swap");
await page.waitForSelector("text=Accountability Snapshot");
await tab("Load & Reserve");
t = await text();
const lastMonth = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
check("meter swap with monthly totals only → ESTIMATED, not COMPLETE", new RegExp(`${lastMonth}[^\\n]*\\n?[^\\n]*ESTIMATED`).test(t) && t.includes(`${lastMonth} — ESTIMATED:`));
check("estimate discloses the mid-month assumption", t.includes("meter configuration active at mid-month") && t.includes("estimate, not a verified figure"));
check("footnote states the effective-service-date rule", t.includes("monthly load is calculated using each meter's effective service dates"));
check("site with interval readings is not estimated", (await page.locator("[data-testid=ew-load-estimates]").count()) === 1);
await page.locator("[data-testid=ew-load-estimates]").scrollIntoViewIfNeeded();
await page.screenshot({ path: "p10-load-estimated.png", fullPage: true });

check("no page/console errors", errors.length === 0);
if (errors.length) console.log(errors.slice(0, 5));
await browser.close(); srv.close();
