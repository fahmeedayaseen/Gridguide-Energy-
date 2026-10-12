import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const srv = createServer((req, res) => { const f = req.url === "/" ? "index.html" : req.url.slice(1).split("?")[0]; try { res.end(readFileSync(f)); } catch { res.statusCode = 404; res.end(); } }).listen(4789);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) process.exitCode = 1; };
const text = () => page.locator("body").innerText();
const fieldInput = (label) => page.locator("label", { hasText: label }).locator("input,select,textarea").first();

await page.goto("http://localhost:4789/");
await page.waitForSelector("text=Data Center Energy & Water");
let t = await text();
check("overview renders PUE from paired readings (1.2)", t.includes("1.2"));
check("unreported water shows 'No data', not 0", /Water consumed\s*No data/.test(t));
check("no '+%' artefact on stat cards", !t.includes("+%"));
await page.screenshot({ path: "1-overview.png", fullPage: true });

// Property filter re-queries the dashboard
await page.selectOption('select[aria-label="Property"]', "p2");
await page.waitForTimeout(150);
const calls = await page.evaluate(() => window.__calls.map((c) => c.path));
check("property filter sends propertyId", calls.some((p) => p.includes("dashboard") && p.includes("propertyId=p2")));
check("filtered property with no data shows empty state", (await text()).includes("No verified readings in this period"));
await page.selectOption('select[aria-label="Property"]', "");

// Custom range
await page.selectOption('select[aria-label="Date range"]', "custom");
check("custom range asks for dates first", (await text()).includes("Choose a start and end date"));
await page.fill('input[aria-label="From"]', "2026-09-01"); await page.fill('input[aria-label="To"]', "2026-10-11");
await page.waitForTimeout(150);
check("custom range sends from/to", (await page.evaluate(() => window.__calls.map((c) => c.path))).some((p) => p.includes("from=2026-09-01&to=2026-10-11")));
await page.selectOption('select[aria-label="Date range"]', "30");

// Assets: add (typing keeps focus), edit, delete
await page.click("button:text-is('Assets')");
const name = fieldInput("Asset name");
await name.click(); await page.keyboard.type("Chiller Plant B", { delay: 5 });
check("typing in a form keeps focus (full value entered)", (await name.inputValue()) === "Chiller Plant B");
await fieldInput("Asset type").selectOption("CHILLER");
await page.click("button:has-text('Add Asset')"); await page.waitForTimeout(150);
const added0 = null; const added = await page.evaluate(() => window.__calls.filter((c) => c.m === "POST" && c.path.includes("/assets")).pop()?.body);
check("asset POST sends blank capacity as blank (null after validation)", added && added.ratedCapacityKw === "" && added.type === "CHILLER");
check("new asset listed", (await text()).includes("Chiller Plant B"));
await page.locator("div", { hasText: /^Steamboat Unit 1/ }).locator("button:has-text('Edit')").first().click();
check("edit form prefilled", (await fieldInput("Asset name").inputValue()) === "Steamboat Unit 1");
await fieldInput("Status").selectOption("RETIRED");
await page.click("button:has-text('Save Changes')"); await page.waitForTimeout(150);
const patched = await page.evaluate(() => window.__calls.filter((c) => c.m === "PATCH").pop());
check("asset PATCH to /assets/a1 with status RETIRED", patched?.path.endsWith("/assets/a1") && patched.body.status === "RETIRED");
await page.locator("div", { hasText: /^Chiller Plant B/ }).locator("button:has-text('Delete')").first().click(); await page.waitForTimeout(150);
check("asset DELETE sent", (await page.evaluate(() => window.__calls.some((c) => c.m === "DELETE" && c.path.includes("/assets/")))));
await page.screenshot({ path: "2-assets.png", fullPage: true });

// Contracts: add with dates, then edit
await page.click("button:text-is('Contracts')");
await fieldInput("Agreement name").fill("Steamboat PPA");
await fieldInput("Seller/developer").fill("Ormat");
await fieldInput("Contract MW").fill("10");
await fieldInput("Price $/MWh").fill("80");
await fieldInput("Delivery start").fill("2027-01-01");
await page.click("button:has-text('Add Contract')"); await page.waitForTimeout(150);
const ppa = await page.evaluate(() => window.__calls.filter((c) => c.m === "POST" && (c.path.includes("/ppas")||c.path.includes("/contracts"))).pop()?.body);
check("PPA POST converts dates to ISO", ppa?.deliveryStartAt === "2027-01-01T00:00:00.000Z" && ppa.deliveryEndAt === "");
check("PPA listed with contract value", (await text()).includes("Estimated contract value"));
await page.screenshot({ path: "3-contracts.png", fullPage: true });

// Readings: list, add with blanks, edit, delete
await page.click("button:text-is('Readings')"); await page.waitForTimeout(150);
t = await text();
check("readings list shows existing reading", t.includes("Reno DC") && t.includes("MANUAL"));
check("save disabled until a measurement is entered", await page.locator("button:has-text('Save Reading')").isDisabled());
await fieldInput("Property *").selectOption("p2");
await fieldInput("Water consumed gal").fill("250");
await page.click("button:has-text('Save Reading')"); await page.waitForTimeout(150);
const rd = await page.evaluate(() => window.__calls.filter((c) => c.m === "POST" && c.path.includes("/readings")).pop()?.body);
check("reading POST sends null for blank fields (not 0)", rd && rd.facilityEnergyKwh === null && rd.waterConsumedGallons === "250");
await page.locator("button:has-text('Edit')").first().click();
check("reading edit prefilled", (await page.locator("text=Edit Reading").count()) > 0);
await page.click("button:has-text('Cancel')");
await page.locator("button:has-text('Delete')").first().click(); await page.waitForTimeout(150);
check("reading DELETE sent", await page.evaluate(() => window.__calls.some((c) => c.m === "DELETE" && c.path.includes("/readings/"))));
await page.screenshot({ path: "4-readings.png", fullPage: true });

// CSV import
await page.click("button:has-text('Import & API')");
const csvText = "property,recordedAt,itEnergyKwh,facilityEnergyKwh,waterConsumedGallons\nReno DC,2026-10-05T10:00:00Z,1000,1150,\nUnknown DC,2026-10-05T11:00:00Z,900,,\nAustin DC,2026-10-05T12:00:00Z,,,\nReno DC,not-a-date,1,1,\n";
await page.setInputFiles('input[type="file"]', { name: "readings.csv", mimeType: "text/csv", buffer: Buffer.from(csvText) });
await page.waitForSelector("text=valid");
t = await text();
check("CSV: 1 valid row, 3 problems reported", t.includes("1 valid") && t.includes("3 with problems"));
check("CSV: unknown property named", t.includes('unknown property "Unknown DC"'));
check("CSV: missing measurements flagged", t.includes("at least one measurement is required"));
await page.click("button:has-text('Import 1 reading')"); await page.waitForSelector("text=Done:");
const imp = await page.evaluate(() => window.__calls.filter((c) => c.m === "POST" && c.path.includes("/readings")).pop()?.body);
const r0 = imp?.readings?.[0];
check("CSV upload: source CSV, stable externalId, blank water null", r0?.source === "CSV" && r0.externalId === "csv:p1:-:2026-10-05T10:00:00.000Z" && r0.waterConsumedGallons === null);
check("API instructions show curl with property id", (await text()).includes("Bearer gg_live_") && (await text()).includes('"propertyId":"p1"'));
await page.click("button:has-text('Manage API keys')");
check("Manage API keys switches tab", (await page.evaluate(() => window.__tab)) === "api");
await page.screenshot({ path: "5-import.png", fullPage: true });

// Mobile layout smoke test
await page.setViewportSize({ width: 390, height: 844 });
await page.click("button:text-is('Readings')"); await page.waitForTimeout(150);
check("mobile: no horizontal page overflow", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await page.screenshot({ path: "6-mobile.png", fullPage: true });

check("no page/console errors", errors.length === 0);
if (errors.length) console.log(errors.slice(0, 5));
await browser.close(); srv.close();
