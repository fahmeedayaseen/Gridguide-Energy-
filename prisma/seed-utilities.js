/**
 * GridGuide — Utility Intelligence Module Seed Data (Phase 4)
 *
 * Seeds the Utilities master table (UtilityTerritory + its Program/Incentive/
 * RatePlan relations) with real utility data, starting with the states the
 * implementation plan calls out first — Indiana, California, Texas, Illinois
 * — plus the other states GridGuide already had partial hardcoded coverage
 * for (Michigan, Minnesota, Pennsylvania, Virginia, North/South Carolina,
 * Georgia, New York, Florida). Expand this file state-by-state for
 * nationwide coverage, or manage rows directly through the Admin Utility
 * Management Portal (Phase 3) once seeded — no redeploy required for
 * day-to-day updates after this initial load.
 *
 * Connection-method flags (supportsGreenButton / supportsArcadia /
 * supportsDirectApi) below are a reasonable starting configuration, not a
 * verified live integration status — confirm and adjust per utility through
 * the admin portal before relying on them to route real customer signups.
 *
 * Idempotent: safe to run multiple times (upserts by eiaid). Uses the same
 * bounding boxes as prisma/seed-geo.js where that utility is already there;
 * run seed-geo.js first (or don't — this creates any missing UtilityTerritory
 * rows itself) if you also want ZIP-code-level territory data.
 *
 * Run: node prisma/seed-utilities.js
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// ─── Utilities master list ─────────────────────────────────────────────────
// Ported 1:1 from lib/geo-intelligence.js's UTILITY_MASTER (that array now
// serves only as a last-resort fallback for utilities not yet in this file).
const UTILITIES = [
  // ── California ──
  { eiaid:"14328", name:"Pacific Gas & Electric", shortName:"PG&E", state:"CA", iso:"CAISO", type:"IOU",
    phone:"1-800-743-5000", website:"https://www.pge.com",
    minLat:36.4, maxLat:42.0, minLng:-124.4, maxLng:-119.0,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:true, directApiProvider:"UtilityAPI",
    programs: [
      { name:"Demand Response", category:"DEMAND_RESPONSE" },
      { name:"SmartRate", category:"DEMAND_RESPONSE" },
      { name:"Peak Day Pricing", category:"DEMAND_RESPONSE" },
      { name:"EV-B TOU", category:"EV" },
      { name:"Battery Incentive Program", category:"BATTERY" },
    ],
    ratePlans: [{ name:"EV-B", isTou:true, isEvRate:true }],
    incentives: [{ name:"PG&E Solar Generation Export Credit", category:"UTILITY_REBATE", value:"Export rates per kWh" }],
  },
  { eiaid:"17609", name:"Southern California Edison", shortName:"SCE", state:"CA", iso:"CAISO", type:"IOU",
    phone:"1-800-655-4555", website:"https://www.sce.com",
    minLat:32.5, maxLat:37.0, minLng:-121.0, maxLng:-114.5,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:true, directApiProvider:"UtilityAPI",
    programs: [
      { name:"Summer Advantage Incentive", category:"DEMAND_RESPONSE" },
      { name:"DRAM", category:"DEMAND_RESPONSE" },
      { name:"CBP", category:"DEMAND_RESPONSE" },
      { name:"TOU-D", category:"SOLAR" },
      { name:"EV Charge Ready", category:"EV" },
    ],
    ratePlans: [{ name:"TOU-EV-7", isTou:true, isEvRate:true }],
    incentives: [{ name:"SCE Residential Battery Incentive", category:"UTILITY_REBATE", value:"$250/kWh installed", estimatedDollarValue:250 }],
  },
  { eiaid:"16609", name:"San Diego Gas & Electric", shortName:"SDG&E", state:"CA", iso:"CAISO", type:"IOU",
    phone:"1-800-411-7343", website:"https://www.sdge.com",
    minLat:32.4, maxLat:33.5, minLng:-117.6, maxLng:-116.0,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:true, directApiProvider:"UtilityAPI",
    programs: [
      { name:"Reduce Your Use", category:"DEMAND_RESPONSE" },
      { name:"EV-TOU", category:"EV" },
      { name:"DR-AP", category:"DEMAND_RESPONSE" },
      { name:"Summer Saver", category:"DEMAND_RESPONSE" },
    ],
    ratePlans: [{ name:"EV-TOU-5", isTou:true, isEvRate:true }],
    incentives: [{ name:"SDG&E EV Charging Incentive", category:"UTILITY_REBATE", value:"Up to $500", estimatedDollarValue:500 }],
  },

  // ── Texas ── (deregulated retail market — Oncor/AEP TX are transmission &
  // distribution only; Green Button access is via ERCOT's Smart Meter Texas)
  { eiaid:"40229", name:"Oncor Electric Delivery", shortName:"Oncor", state:"TX", iso:"ERCOT", type:"Transmission",
    phone:"1-888-313-4747", website:"https://www.oncor.com",
    minLat:31.5, maxLat:34.0, minLng:-98.5, maxLng:-95.5,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:false, netMeteringAvailable:false,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:false,
    greenButtonAuthUrl:"https://www.smartmetertexas.com",
    programs: [{ name:"Demand Response (via REPs)", category:"DEMAND_RESPONSE" }, { name:"Smart Grid Programs", category:"ENERGY_EFFICIENCY" }],
  },
  { eiaid:"57877", name:"AEP Texas", shortName:"AEP TX", state:"TX", iso:"ERCOT", type:"Transmission",
    phone:"1-866-223-8508", website:"https://www.aeptexas.com",
    minLat:26.0, maxLat:30.0, minLng:-99.5, maxLng:-96.5,
    vppEligible:true, demandResponseAvailable:false, touRatesAvailable:false, netMeteringAvailable:false,
    supportsGreenButton:true, supportsArcadia:false, supportsDirectApi:false,
    greenButtonAuthUrl:"https://www.smartmetertexas.com",
    programs: [{ name:"Energy Efficiency Programs", category:"ENERGY_EFFICIENCY" }],
  },

  // ── Indiana ──
  { eiaid:"6455", name:"Duke Energy Indiana", shortName:"Duke IN", state:"IN", iso:"MISO", type:"IOU",
    phone:"1-800-521-2232", website:"https://www.duke-energy.com/home/products/power-manager",
    minLat:38.0, maxLat:41.5, minLng:-87.5, maxLng:-84.8,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:false,
    programs: [
      { name:"Power Manager", category:"DEMAND_RESPONSE" },
      { name:"AC Cycling", category:"DEMAND_RESPONSE" },
      { name:"Smart Saver", category:"ENERGY_EFFICIENCY" },
      { name:"Time-of-Use", category:"SOLAR" },
      { name:"EV Charger Rebate", category:"EV" },
    ],
    ratePlans: [{ name:"EV-SB", isTou:true, isEvRate:true }],
    incentives: [
      { name:"Duke IN AC Cycling Rebate", category:"UTILITY_REBATE", value:"$40/season", estimatedDollarValue:40 },
      { name:"Duke IN Battery Program", category:"UTILITY_REBATE", value:"$300 enrollment bonus", estimatedDollarValue:300 },
    ],
  },
  { eiaid:"794", name:"AES Indiana", shortName:"AES IN", state:"IN", iso:"MISO", type:"IOU",
    phone:"1-888-261-8222", website:"https://www.aesindiana.com",
    minLat:39.5, maxLat:40.2, minLng:-86.5, maxLng:-85.8,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:false,
    programs: [
      { name:"Demand Response", category:"DEMAND_RESPONSE" },
      { name:"Smart Energy", category:"ENERGY_EFFICIENCY" },
      { name:"EnergyConnect", category:"DEMAND_RESPONSE" },
      { name:"TOU Rates", category:"SOLAR" },
    ],
    incentives: [
      { name:"AES Indiana EV Charger Rebate", category:"UTILITY_REBATE", value:"Up to $500", estimatedDollarValue:500 },
      { name:"AES EnergyConnect Battery Program", category:"UTILITY_REBATE", value:"Monthly payments" },
    ],
  },
  { eiaid:"7397", name:"Indiana Michigan Power", shortName:"I&M", state:"IN", iso:"PJM", type:"IOU",
    phone:"1-800-311-4634", website:"https://www.indianamichiganpower.com",
    minLat:40.5, maxLat:41.8, minLng:-85.8, maxLng:-84.8,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:false, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:false,
    programs: [
      { name:"Demand Response", category:"DEMAND_RESPONSE" },
      { name:"Energy Efficiency Rebates", category:"ENERGY_EFFICIENCY" },
      { name:"EV Charger Rebate", category:"EV" },
    ],
    incentives: [{ name:"I&M Energy Efficiency Rebates", category:"UTILITY_REBATE", value:"Up to $1,200", estimatedDollarValue:1200 }],
  },

  // ── Illinois ──
  { eiaid:"3755", name:"Commonwealth Edison (ComEd)", shortName:"ComEd", state:"IL", iso:"PJM", type:"IOU",
    phone:"1-800-334-7661", website:"https://www.comed.com",
    minLat:40.4, maxLat:42.5, minLng:-91.5, maxLng:-87.0,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:true, directApiProvider:"UtilityAPI",
    programs: [
      { name:"Peak Time Savings", category:"DEMAND_RESPONSE" },
      { name:"Hourly Pricing", category:"SOLAR" },
      { name:"BYOB (Bring Your Own Battery)", category:"BATTERY" },
      { name:"EV Charger Rebate", category:"EV" },
    ],
    incentives: [{ name:"ComEd EV Charger Rebate", category:"UTILITY_REBATE", value:"Up to $750", estimatedDollarValue:750 }],
  },

  // ── Michigan ──
  { eiaid:"15466", name:"Consumers Energy", shortName:"CEI", state:"MI", iso:"MISO", type:"IOU",
    phone:"1-800-477-5050", website:"https://www.consumersenergy.com",
    minLat:41.7, maxLat:47.5, minLng:-87.0, maxLng:-82.4,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:false,
    programs: [
      { name:"Lower My Bill", category:"ENERGY_EFFICIENCY" },
      { name:"AC Cool Credits", category:"DEMAND_RESPONSE" },
      { name:"EV Time-of-Use", category:"EV" },
      { name:"Clean Energy", category:"SOLAR" },
    ],
    ratePlans: [{ name:"EV Rate", isTou:true, isEvRate:true }],
  },

  // ── Minnesota ──
  { eiaid:"13998", name:"Northern States Power (Xcel Energy)", shortName:"Xcel", state:"MN", iso:"MISO", type:"IOU",
    phone:"1-800-895-4999", website:"https://www.xcelenergy.com",
    minLat:43.5, maxLat:49.4, minLng:-97.2, maxLng:-89.5,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:true, directApiProvider:"UtilityAPI",
    programs: [
      { name:"Demand Response", category:"DEMAND_RESPONSE" },
      { name:"Windsource", category:"SOLAR" },
      { name:"EV Accelerate At Home", category:"EV" },
      { name:"Solar*Rewards", category:"SOLAR" },
    ],
    ratePlans: [{ name:"EV Optimize", isTou:true, isEvRate:true }],
    incentives: [
      { name:"Xcel Solar*Rewards", category:"UTILITY_REBATE", value:"$0.09/kWh solar credit" },
      { name:"Xcel Battery Incentive", category:"UTILITY_REBATE", value:"$250/kWh installed", estimatedDollarValue:250 },
    ],
  },

  // ── Pennsylvania ──
  { eiaid:"13135", name:"PECO Energy", shortName:"PECO", state:"PA", iso:"PJM", type:"IOU",
    phone:"1-800-494-4000", website:"https://www.peco.com",
    minLat:39.9, maxLat:40.4, minLng:-75.6, maxLng:-75.0,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:false,
    programs: [
      { name:"Smart A/C", category:"DEMAND_RESPONSE" },
      { name:"Load Control", category:"DEMAND_RESPONSE" },
      { name:"Time-of-Use", category:"SOLAR" },
      { name:"EV Charging Program", category:"EV" },
    ],
  },

  // ── Virginia ──
  { eiaid:"7801", name:"Dominion Energy Virginia", shortName:"Dominion", state:"VA", iso:"PJM", type:"IOU",
    phone:"1-866-366-4357", website:"https://www.dominionenergy.com",
    minLat:36.5, maxLat:39.5, minLng:-83.7, maxLng:-75.2,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:false,
    programs: [
      { name:"BrightSuite", category:"ENERGY_EFFICIENCY" },
      { name:"EnergyShare", category:"ENERGY_EFFICIENCY" },
      { name:"Time-of-Use", category:"SOLAR" },
      { name:"EV Charging Program", category:"EV" },
    ],
    ratePlans: [{ name:"EV Rider", isTou:true, isEvRate:true }],
  },

  // ── North Carolina ──
  { eiaid:"6452", name:"Duke Energy Carolinas", shortName:"Duke NC", state:"NC", iso:"SERC", type:"IOU",
    phone:"1-800-777-9898", website:"https://www.duke-energy.com",
    minLat:33.8, maxLat:36.6, minLng:-84.3, maxLng:-79.0,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:false, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:false,
    programs: [
      { name:"PowerSave Home", category:"ENERGY_EFFICIENCY" },
      { name:"Smart Saver", category:"ENERGY_EFFICIENCY" },
      { name:"EV Charging", category:"EV" },
      { name:"Home Energy Reports", category:"ENERGY_EFFICIENCY" },
    ],
  },

  // ── Georgia ── (Southern Co. subsidiary — no Green Button Connect today)
  { eiaid:"7140", name:"Georgia Power", shortName:"GA Power", state:"GA", iso:"SERC", type:"IOU",
    phone:"1-888-655-5888", website:"https://www.georgiapower.com",
    minLat:30.4, maxLat:35.0, minLng:-85.6, maxLng:-80.8,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:false, supportsArcadia:true, supportsDirectApi:false,
    programs: [
      { name:"AC Cycling", category:"DEMAND_RESPONSE" },
      { name:"VPeakSaver", category:"DEMAND_RESPONSE" },
      { name:"PluggedIn GA", category:"EV" },
      { name:"TOU-PEV", category:"EV" },
    ],
    ratePlans: [{ name:"TOU-PEV", isTou:true, isEvRate:true }],
  },

  // ── New York ──
  { eiaid:"13057", name:"Consolidated Edison", shortName:"ConEd", state:"NY", iso:"NYISO", type:"IOU",
    phone:"1-800-752-6633", website:"https://www.coned.com",
    minLat:40.4, maxLat:41.1, minLng:-74.3, maxLng:-73.6,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:true, directApiProvider:"UtilityAPI",
    programs: [
      { name:"PowerReady EV", category:"EV" },
      { name:"Smart Usage Rewards", category:"DEMAND_RESPONSE" },
      { name:"Demand Response", category:"DEMAND_RESPONSE" },
      { name:"EV Make-Ready", category:"EV" },
    ],
    incentives: [{ name:"ConEd Battery Reward Program", category:"UTILITY_REBATE", value:"$350+/kW enrolled", estimatedDollarValue:350 }],
  },
  { eiaid:"13294", name:"National Grid NY", shortName:"Nat Grid", state:"NY", iso:"NYISO", type:"IOU",
    phone:"1-800-867-5222", website:"https://www.nationalgridus.com",
    minLat:42.0, maxLat:45.0, minLng:-79.8, maxLng:-73.3,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:false,
    programs: [
      { name:"SmartUsage", category:"DEMAND_RESPONSE" },
      { name:"Demand Response", category:"DEMAND_RESPONSE" },
      { name:"EV Charging", category:"EV" },
      { name:"Clean Heating Rebates", category:"ENERGY_EFFICIENCY" },
    ],
  },

  // ── Florida ──
  { eiaid:"6452", name:"Florida Power & Light", shortName:"FPL", state:"FL", iso:"FRCC", type:"IOU",
    phone:"1-800-375-2434", website:"https://www.fpl.com",
    minLat:24.4, maxLat:30.8, minLng:-87.6, maxLng:-79.9,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:false,
    programs: [
      { name:"On Call Savings", category:"DEMAND_RESPONSE" },
      { name:"EnergyConnect", category:"DEMAND_RESPONSE" },
      { name:"EV Charger Rebate", category:"EV" },
      { name:"SolarNow", category:"SOLAR" },
    ],
    incentives: [{ name:"FPL SolarNow", category:"UTILITY_REBATE", value:"Community solar subscription" }],
  },
  { eiaid:"7486", name:"Duke Energy Florida", shortName:"Duke FL", state:"FL", iso:"FRCC", type:"IOU",
    phone:"1-800-700-8744", website:"https://www.duke-energy.com",
    minLat:27.5, maxLat:30.7, minLng:-83.5, maxLng:-80.9,
    vppEligible:true, demandResponseAvailable:true, touRatesAvailable:true, netMeteringAvailable:true,
    supportsGreenButton:true, supportsArcadia:true, supportsDirectApi:false,
    programs: [
      { name:"AC Saver", category:"DEMAND_RESPONSE" },
      { name:"Smart Saver Home", category:"ENERGY_EFFICIENCY" },
      { name:"EV Charger Rebate", category:"EV" },
    ],
  },
];

// ─── Statewide / federal incentives (utilityId left null — apply to a whole state) ──
// Ported from lib/geo-intelligence.js's STATE_INCENTIVES. DEFAULT entries apply to
// every state — seeded once per state actually present in UTILITIES above, since
// UtilityIncentive rows are looked up by (state, utilityId=null).
const STATEWIDE_INCENTIVES = {
  CA: [
    { name:"Net Energy Metering 3.0", category:"NET_METERING", value:"Export credit rates vary" },
    { name:"Self-Generation Incentive Program (SGIP)", category:"STATE_REBATE", value:"Up to $1,000/kWh battery", estimatedDollarValue:1000 },
    { name:"California Solar Initiative", category:"UTILITY_REBATE", value:"Varies by utility" },
    { name:"Clean Vehicle Rebate Project", category:"EV_REBATE", value:"Up to $7,000", estimatedDollarValue:7000 },
    { name:"CA Property Tax Exclusion (Solar)", category:"PROPERTY_TAX", value:"Solar excluded from assessment" },
  ],
  TX: [
    { name:"Net Metering (varies by utility)", category:"NET_METERING", value:"Varies by utility" },
    { name:"TX Solar Property Tax Exemption", category:"PROPERTY_TAX", value:"Solar equipment excluded" },
    { name:"TX Light-Duty Motor Vehicle Purchase", category:"EV_REBATE", value:"Up to $2,500", estimatedDollarValue:2500 },
  ],
  IN: [
    { name:"Indiana Net Metering", category:"NET_METERING", value:"Retail rate credit" },
    { name:"Indiana Solar Property Tax Deduction", category:"PROPERTY_TAX", value:"System cost deducted from assessed value" },
    { name:"Indiana Sales Tax Exemption (Solar)", category:"SALES_TAX", value:"100% sales tax exempt" },
  ],
  IL: [
    { name:"Illinois Shines (Adjustable Block Program)", category:"STATE_REBATE", value:"SREC-based incentive" },
    { name:"Illinois Solar for All", category:"STATE_REBATE", value:"Income-qualified incentive" },
  ],
  NY: [
    { name:"NY State Solar Tax Credit", category:"STATE_TAX_CREDIT", value:"25% up to $5,000", estimatedDollarValue:5000 },
    { name:"NY Solar Property Tax Exemption", category:"PROPERTY_TAX", value:"15-year exemption" },
    { name:"NYSERDA Clean Energy Program", category:"STATE_REBATE", value:"Varies by technology" },
    { name:"NY-Sun Incentive Program", category:"STATE_REBATE", value:"$0.20-0.40/W for solar" },
  ],
  GA: [],
  NC: [],
  VA: [],
  PA: [],
  MI: [],
  MN: [],
  FL: [],
};

const FEDERAL_INCENTIVES = [
  { name:"Federal Solar Tax Credit (ITC)", category:"FEDERAL_TAX_CREDIT", value:"30% of system cost", estimatedDollarValue:null },
  { name:"Federal EV Tax Credit", category:"FEDERAL_TAX_CREDIT", value:"Up to $7,500", estimatedDollarValue:7500 },
  { name:"Residential Clean Energy Credit (Battery)", category:"FEDERAL_TAX_CREDIT", value:"30% of battery cost", estimatedDollarValue:null },
];

async function main() {
  console.log(`[seed-utilities] Loading ${UTILITIES.length} utilities across ${new Set(UTILITIES.map(u=>u.state)).size} states...`);

  for (const u of UTILITIES) {
    const { programs = [], ratePlans = [], incentives = [], ...utilityFields } = u;

    const utility = await prisma.utilityTerritory.upsert({
      where: { eiaid: u.eiaid },
      update: utilityFields,
      create: utilityFields,
    });

    for (const p of programs) {
      const existing = await prisma.utilityProgram.findFirst({ where: { utilityId: utility.id, name: p.name } });
      if (!existing) await prisma.utilityProgram.create({ data: { ...p, utilityId: utility.id } });
    }
    for (const rp of ratePlans) {
      const existing = await prisma.utilityRatePlan.findFirst({ where: { utilityId: utility.id, name: rp.name } });
      if (!existing) await prisma.utilityRatePlan.create({ data: { ...rp, utilityId: utility.id } });
    }
    for (const inc of incentives) {
      const existing = await prisma.utilityIncentive.findFirst({ where: { utilityId: utility.id, name: inc.name } });
      if (!existing) await prisma.utilityIncentive.create({ data: { ...inc, utilityId: utility.id, state: u.state } });
    }

    console.log(`  ✓ ${u.shortName} (${u.state}) — ${programs.length} programs, ${ratePlans.length} rate plans, ${incentives.length} utility incentives`);
  }

  console.log(`[seed-utilities] Loading statewide/federal incentives...`);
  const states = new Set(UTILITIES.map((u) => u.state));
  for (const state of states) {
    const rows = [...(STATEWIDE_INCENTIVES[state] || []), ...FEDERAL_INCENTIVES];
    for (const inc of rows) {
      const existing = await prisma.utilityIncentive.findFirst({ where: { utilityId: null, state, name: inc.name } });
      if (!existing) await prisma.utilityIncentive.create({ data: { ...inc, utilityId: null, state } });
    }
    console.log(`  ✓ ${state} — ${rows.length} statewide/federal incentives`);
  }

  console.log("[seed-utilities] Done.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
