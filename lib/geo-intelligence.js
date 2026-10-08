/**
 * GridGuide — Geo Intelligence Engine
 *
 * Full pipeline: Address → Utility → ISO/RTO → Incentives → VPP → Installers
 *
 * Pipeline:
 *   User enters address
 *        ↓
 *   Geocode address (lat/lng, ZIP, county, state)
 *        ↓
 *   Identify electric utility (by lat/lng polygon or ZIP lookup)
 *        ↓
 *   Identify ISO/RTO (CAISO, ERCOT, PJM, MISO, NYISO, SPP, ISONE)
 *        ↓
 *   Identify state incentives (federal ITC, state rebates, SREC markets)
 *        ↓
 *   Identify VPP / demand response programs
 *        ↓
 *   Identify local installers (radius search, tier-sorted)
 *        ↓
 *   Return complete opportunity profile
 */

import { cacheGet, cacheSet } from "./redis.js";
import { prisma } from "./db.js";
import { geocodeAddress, detectUtility, findNearbyInstallers } from "./geo.js";
import { logger } from "./sentry.js";
import { resolveConnectionMethod } from "./utility-routing.js";

// ─── ISO / RTO STATE MAP ───────────────────────────────────────────────────────
// Maps US states to their primary electric grid operator (ISO/RTO).
// Some states span multiple ISOs — listed in priority order.
const STATE_ISO = {
  // CAISO (California)
  CA: { iso: "CAISO",  name: "California ISO",           website: "https://www.caiso.com" },

  // ERCOT (Texas — most of state)
  TX: { iso: "ERCOT",  name: "Electric Reliability Council of Texas", website: "https://www.ercot.com" },

  // PJM Interconnection (Mid-Atlantic, Midwest)
  PA: { iso: "PJM",    name: "PJM Interconnection",      website: "https://www.pjm.com" },
  NJ: { iso: "PJM",    name: "PJM Interconnection",      website: "https://www.pjm.com" },
  MD: { iso: "PJM",    name: "PJM Interconnection",      website: "https://www.pjm.com" },
  DE: { iso: "PJM",    name: "PJM Interconnection",      website: "https://www.pjm.com" },
  DC: { iso: "PJM",    name: "PJM Interconnection",      website: "https://www.pjm.com" },
  VA: { iso: "PJM",    name: "PJM Interconnection",      website: "https://www.pjm.com" },
  WV: { iso: "PJM",    name: "PJM Interconnection",      website: "https://www.pjm.com" },
  OH: { iso: "PJM",    name: "PJM Interconnection",      website: "https://www.pjm.com" },
  KY: { iso: "PJM",    name: "PJM Interconnection",      website: "https://www.pjm.com" },
  MI: { iso: "PJM",    name: "PJM Interconnection",      website: "https://www.pjm.com" }, // partial
  IN: { iso: "PJM",    name: "PJM Interconnection",      website: "https://www.pjm.com" }, // partial, rest MISO
  IL: { iso: "PJM",    name: "PJM Interconnection",      website: "https://www.pjm.com" }, // partial

  // MISO (Midwest + South)
  MN: { iso: "MISO",   name: "Midcontinent ISO",         website: "https://www.misoenergy.org" },
  IA: { iso: "MISO",   name: "Midcontinent ISO",         website: "https://www.misoenergy.org" },
  WI: { iso: "MISO",   name: "Midcontinent ISO",         website: "https://www.misoenergy.org" },
  ND: { iso: "MISO",   name: "Midcontinent ISO",         website: "https://www.misoenergy.org" },
  SD: { iso: "MISO",   name: "Midcontinent ISO",         website: "https://www.misoenergy.org" },
  NE: { iso: "MISO",   name: "Midcontinent ISO",         website: "https://www.misoenergy.org" },
  MO: { iso: "MISO",   name: "Midcontinent ISO",         website: "https://www.misoenergy.org" },
  AR: { iso: "MISO",   name: "Midcontinent ISO",         website: "https://www.misoenergy.org" },
  MS: { iso: "MISO",   name: "Midcontinent ISO",         website: "https://www.misoenergy.org" },
  LA: { iso: "MISO",   name: "Midcontinent ISO",         website: "https://www.misoenergy.org" },
  MT: { iso: "MISO",   name: "Midcontinent ISO",         website: "https://www.misoenergy.org" },

  // NYISO (New York)
  NY: { iso: "NYISO",  name: "New York ISO",             website: "https://www.nyiso.com" },

  // ISO-NE (New England)
  MA: { iso: "ISONE",  name: "ISO New England",          website: "https://www.iso-ne.com" },
  CT: { iso: "ISONE",  name: "ISO New England",          website: "https://www.iso-ne.com" },
  RI: { iso: "ISONE",  name: "ISO New England",          website: "https://www.iso-ne.com" },
  VT: { iso: "ISONE",  name: "ISO New England",          website: "https://www.iso-ne.com" },
  NH: { iso: "ISONE",  name: "ISO New England",          website: "https://www.iso-ne.com" },
  ME: { iso: "ISONE",  name: "ISO New England",          website: "https://www.iso-ne.com" },

  // SPP (Southwest Power Pool)
  KS: { iso: "SPP",    name: "Southwest Power Pool",     website: "https://www.spp.org" },
  OK: { iso: "SPP",    name: "Southwest Power Pool",     website: "https://www.spp.org" },
  WY: { iso: "SPP",    name: "Southwest Power Pool",     website: "https://www.spp.org" }, // partial

  // Southeast (no ISO — bilateral markets)
  FL: { iso: "FRCC",   name: "Florida Reliability Coordinating Council", website: null },
  GA: { iso: "SERC",   name: "SERC Reliability (bilateral)", website: null },
  NC: { iso: "SERC",   name: "SERC Reliability (bilateral)", website: null },
  SC: { iso: "SERC",   name: "SERC Reliability (bilateral)", website: null },
  AL: { iso: "SERC",   name: "SERC Reliability (bilateral)", website: null },
  TN: { iso: "SERC",   name: "SERC Reliability (bilateral)", website: null },

  // Northwest
  WA: { iso: "WECC",   name: "Western Interconnection (WECC)", website: null },
  OR: { iso: "WECC",   name: "Western Interconnection (WECC)", website: null },
  ID: { iso: "WECC",   name: "Western Interconnection (WECC)", website: null },
  NV: { iso: "WECC",   name: "Western Interconnection (WECC)", website: null },
  AZ: { iso: "WECC",   name: "Western Interconnection (WECC)", website: null },
  NM: { iso: "WECC",   name: "Western Interconnection (WECC)", website: null },
  UT: { iso: "WECC",   name: "Western Interconnection (WECC)", website: null },
  CO: { iso: "WECC",   name: "Western Interconnection (WECC)", website: null },
};

// ─── UTILITY MASTER LIST ──────────────────────────────────────────────────────
// Top US electric utilities with VPP/DR program info, ZIP prefix coverage, EIA IDs
const UTILITY_MASTER = [
  // California
  { eiaid:"14328", name:"Pacific Gas & Electric",    short:"PG&E",   state:"CA", iso:"CAISO", type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"EV-B",
    programs:["Demand Response","SmartRate","Peak Day Pricing","EV-B TOU","Battery Incentive Program"],
    zipPrefixes:["94","95","93"],
    contact:"1-800-743-5000", website:"https://www.pge.com" },

  { eiaid:"17609", name:"Southern California Edison", short:"SCE",   state:"CA", iso:"CAISO", type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"TOU-EV-7",
    programs:["Summer Advantage Incentive","DRAM","CBP","TOU-D","EV Charge Ready"],
    zipPrefixes:["90","91","92"],
    contact:"1-800-655-4555", website:"https://www.sce.com" },

  { eiaid:"16609", name:"San Diego Gas & Electric",  short:"SDG&E",  state:"CA", iso:"CAISO", type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"EV-TOU-5",
    programs:["Reduce Your Use","EV-TOU","DR-AP","Summer Saver"],
    zipPrefixes:["91","92"],
    contact:"1-800-411-7343", website:"https://www.sdge.com" },

  // Texas
  { eiaid:"40229", name:"Oncor Electric Delivery",   short:"Oncor",  state:"TX", iso:"ERCOT", type:"Transmission",
    vpp:true,  dr:true,  touRates:false, evRate:null,
    programs:["Demand Response (via REPs)","Smart Grid Programs"],
    zipPrefixes:["75","76","79"],
    contact:"1-888-313-4747", website:"https://www.oncor.com" },

  { eiaid:"57877", name:"AEP Texas",                 short:"AEP TX", state:"TX", iso:"ERCOT", type:"Transmission",
    vpp:true,  dr:false, touRates:false, evRate:null,
    programs:["Energy Efficiency Programs"],
    zipPrefixes:["77","78","79"],
    contact:"1-866-223-8508", website:"https://www.aeptexas.com" },

  // Indiana
  { eiaid:"6455",  name:"Duke Energy Indiana",       short:"Duke IN",state:"IN", iso:"MISO",  type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"EV-SB",
    programs:["Power Manager","AC Cycling","Smart Saver","Time-of-Use","EV Charger Rebate"],
    zipPrefixes:["46","47"],
    contact:"1-800-521-2232", website:"https://www.duke-energy.com/home/products/power-manager" },

  { eiaid:"794",   name:"AES Indiana",               short:"AES IN", state:"IN", iso:"MISO",  type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:null,
    programs:["Demand Response","Smart Energy","EnergyConnect","TOU Rates"],
    zipPrefixes:["46"],
    contact:"1-888-261-8222", website:"https://www.aesindiana.com" },

  { eiaid:"7397",  name:"Indiana Michigan Power",    short:"I&M",    state:"IN", iso:"PJM",   type:"IOU",
    vpp:true,  dr:true,  touRates:false, evRate:null,
    programs:["Demand Response","Energy Efficiency Rebates","EV Charger Rebate"],
    zipPrefixes:["46","47"],
    contact:"1-800-311-4634", website:"https://www.indianamichiganpower.com" },

  // Midwest — more utilities
  { eiaid:"15466", name:"Consumers Energy",          short:"CEI",    state:"MI", iso:"MISO",  type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"EV Rate",
    programs:["Lower My Bill","AC Cool Credits","EV Time-of-Use","Clean Energy"],
    zipPrefixes:["48","49"],
    contact:"1-800-477-5050", website:"https://www.consumersenergy.com" },

  { eiaid:"13998", name:"Northern States Power (Xcel)", short:"Xcel",state:"MN", iso:"MISO", type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"EV Optimize",
    programs:["Demand Response","Windsource","EV Accelerate At Home","Solar*Rewards"],
    zipPrefixes:["55","56"],
    contact:"1-800-895-4999", website:"https://www.xcelenergy.com" },

  // PJM Mid-Atlantic
  { eiaid:"3265",  name:"Commonwealth Edison (ComEd)", short:"ComEd",state:"IL", iso:"PJM",   type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"Electric Vehicle Rate",
    programs:["Peak Time Savings","Hourly Pricing","BYOB","EV Charger Rebate"],
    zipPrefixes:["60","61","62"],
    contact:"1-800-334-7661", website:"https://www.comed.com" },

  { eiaid:"13135", name:"PECO Energy",               short:"PECO",   state:"PA", iso:"PJM",   type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"EV Charging",
    programs:["Smart A/C","Load Control","Time-of-Use","EV Charging Program"],
    zipPrefixes:["19"],
    contact:"1-800-494-4000", website:"https://www.peco.com" },

  { eiaid:"7801",  name:"Dominion Energy Virginia",  short:"Dominion",state:"VA",iso:"PJM",   type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"EV Rider",
    programs:["BrightSuite","EnergyShare","Time-of-Use","EV Charging Program"],
    zipPrefixes:["22","23","24"],
    contact:"1-866-366-4357", website:"https://www.dominionenergy.com" },

  // Southeast
  { eiaid:"6452",  name:"Duke Energy Carolinas",     short:"Duke NC",state:"NC", iso:"SERC",  type:"IOU",
    vpp:true,  dr:true,  touRates:false, evRate:"EV Pricing",
    programs:["PowerSave Home","Smart Saver","EV Charging","Home Energy Reports"],
    zipPrefixes:["27","28"],
    contact:"1-800-777-9898", website:"https://www.duke-energy.com" },

  { eiaid:"7140",  name:"Georgia Power",             short:"GA Power",state:"GA",iso:"SERC",  type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"TOU-PEV",
    programs:["AC Cycling","VPeakSaver","PluggedIn GA","TOU-PEV"],
    zipPrefixes:["30","31"],
    contact:"1-888-655-5888", website:"https://www.georgiapower.com" },

  // New York / Northeast
  { eiaid:"13057", name:"Con Edison",                short:"ConEd",  state:"NY", iso:"NYISO",  type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"EV rates",
    programs:["PowerReady EV","Smart Usage Rewards","Demand Response","EV Make-Ready"],
    zipPrefixes:["10","11"],
    contact:"1-800-752-6633", website:"https://www.coned.com" },

  { eiaid:"13294", name:"National Grid NY",          short:"Nat Grid",state:"NY",iso:"NYISO",  type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"EV Time-of-Use",
    programs:["SmartUsage","Demand Response","EV Charging","Clean Heating Rebates"],
    zipPrefixes:["12","13","14"],
    contact:"1-800-867-5222", website:"https://www.nationalgridus.com" },

  // Florida
  { eiaid:"6452",  name:"Florida Power & Light",     short:"FPL",    state:"FL", iso:"FRCC",   type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"EV Rate Schedule",
    programs:["On Call Savings","EnergyConnect","EV Charger Rebate","SolarNow"],
    zipPrefixes:["33","34"],
    contact:"1-800-375-2434", website:"https://www.fpl.com" },

  { eiaid:"7486",  name:"Duke Energy Florida",       short:"Duke FL",state:"FL", iso:"FRCC",   type:"IOU",
    vpp:true,  dr:true,  touRates:true,  evRate:"EV rate",
    programs:["AC Saver","Smart Saver Home","EV Charger Rebate"],
    zipPrefixes:["32","33"],
    contact:"1-800-700-8744", website:"https://www.duke-energy.com" },
];

// ─── STATE INCENTIVE DATABASE ──────────────────────────────────────────────────
const STATE_INCENTIVES = {
  CA: [
    { id:"CA-ITC",    name:"Federal Solar Tax Credit (ITC)",           type:"federal_tax_credit",  value:"30% of system cost",     expires:"2032", stackable:true },
    { id:"CA-NEM3",   name:"Net Energy Metering 3.0",                   type:"net_metering",         value:"Export credit rates vary",expires:null,   stackable:true },
    { id:"CA-SGIP",   name:"Self-Generation Incentive Program (SGIP)",  type:"state_rebate",         value:"Up to $1,000/kWh battery",expires:null,   stackable:true },
    { id:"CA-CSI",    name:"California Solar Initiative",               type:"utility_rebate",       value:"Varies by utility",       expires:null,   stackable:true },
    { id:"CA-TECH",   name:"Clean Vehicle Rebate Project",              type:"ev_rebate",            value:"Up to $7,000",            expires:null,   stackable:true },
    { id:"CA-PROP",   name:"CA Property Tax Exclusion (Solar)",         type:"property_tax",         value:"Solar excluded from assessment",expires:null,stackable:true },
  ],
  TX: [
    { id:"TX-ITC",    name:"Federal Solar Tax Credit (ITC)",           type:"federal_tax_credit",  value:"30% of system cost",     expires:"2032", stackable:true },
    { id:"TX-NEM",    name:"Net Metering (varies by utility)",          type:"net_metering",         value:"Varies by utility",       expires:null,   stackable:true },
    { id:"TX-PROP",   name:"TX Solar Property Tax Exemption",          type:"property_tax",         value:"Solar equipment excluded",expires:null,   stackable:true },
    { id:"TX-EV",     name:"TX Light-Duty Motor Vehicle Purchase",      type:"ev_rebate",            value:"Up to $2,500",            expires:null,   stackable:true },
  ],
  IN: [
    { id:"IN-ITC",    name:"Federal Solar Tax Credit (ITC)",           type:"federal_tax_credit",  value:"30% of system cost",     expires:"2032", stackable:true },
    { id:"IN-NEM",    name:"Indiana Net Metering",                      type:"net_metering",         value:"Retail rate credit",      expires:null,   stackable:true },
    { id:"IN-PROP",   name:"Indiana Solar Property Tax Deduction",      type:"property_tax",         value:"System cost deducted from assessed value",expires:null,stackable:true },
    { id:"IN-SALES",  name:"Indiana Sales Tax Exemption (Solar)",       type:"sales_tax",            value:"100% sales tax exempt",   expires:null,   stackable:true },
  ],
  NY: [
    { id:"NY-ITC",    name:"Federal Solar Tax Credit (ITC)",           type:"federal_tax_credit",  value:"30% of system cost",     expires:"2032", stackable:true },
    { id:"NY-CREDIT", name:"NY State Solar Tax Credit",                 type:"state_tax_credit",     value:"25% up to $5,000",       expires:null,   stackable:true },
    { id:"NY-PROP",   name:"NY Solar Property Tax Exemption",          type:"property_tax",         value:"15-year exemption",       expires:null,   stackable:true },
    { id:"NY-NYSERDA",name:"NYSERDA Clean Energy Program",             type:"state_rebate",         value:"Varies by technology",    expires:null,   stackable:true },
    { id:"NY-SREC",   name:"NY-Sun Incentive Program",                 type:"state_rebate",         value:"$0.20-0.40/W for solar",  expires:null,   stackable:true },
  ],
  MA: [
    { id:"MA-ITC",    name:"Federal Solar Tax Credit (ITC)",           type:"federal_tax_credit",  value:"30% of system cost",     expires:"2032", stackable:true },
    { id:"MA-CREDIT", name:"MA Solar Tax Credit",                       type:"state_tax_credit",     value:"15% up to $1,000",       expires:null,   stackable:true },
    { id:"MA-SREC",   name:"MA SREC-II Program",                        type:"renewable_credit",     value:"$250-350/MWh",           expires:null,   stackable:true },
    { id:"MA-STC",    name:"Solar Massachusetts Renewable Target (SMART)",type:"state_rebate",      value:"Fixed tariff per kWh",    expires:null,   stackable:true },
  ],
  NJ: [
    { id:"NJ-ITC",    name:"Federal Solar Tax Credit (ITC)",           type:"federal_tax_credit",  value:"30% of system cost",     expires:"2032", stackable:true },
    { id:"NJ-TREC",   name:"NJ Transition Renewable Energy Certificate", type:"renewable_credit",   value:"~$90/MWh",              expires:null,   stackable:true },
    { id:"NJ-PROP",   name:"NJ Solar Property Tax Exemption",          type:"property_tax",         value:"100% exempt",            expires:null,   stackable:true },
    { id:"NJ-SALES",  name:"NJ Sales Tax Exemption (Solar)",           type:"sales_tax",            value:"100% exempt",            expires:null,   stackable:true },
  ],
  // Default — applies to all states
  DEFAULT: [
    { id:"FED-ITC",   name:"Federal Solar Tax Credit (ITC)",           type:"federal_tax_credit",  value:"30% of system cost",     expires:"2032", stackable:true },
    { id:"FED-EV",    name:"Federal EV Tax Credit",                     type:"federal_tax_credit",  value:"Up to $7,500",           expires:"2032", stackable:true },
    { id:"FED-BATT",  name:"Residential Clean Energy Credit (Battery)", type:"federal_tax_credit",  value:"30% of battery cost",    expires:"2032", stackable:true },
  ],
};

// ─── VPP PROGRAM DATABASE ─────────────────────────────────────────────────────
const VPP_PROGRAMS = {
  CAISO: {
    iso: "CAISO",
    programs: [
      { id:"caiso-dr",   name:"Demand Response Program",        type:"DR",  earnings:"Varies by program", enrolled:false  },
      { id:"caiso-flex", name:"Flex Alert Voluntary Program",   type:"DR",  earnings:"Varies by program", enrolled:false },
      { id:"caiso-nem",  name:"Net Energy Metering Export",     type:"NEM", earnings:"Varies by program", enrolled:false  },
    ]
  },
  ERCOT: {
    iso: "ERCOT",
    programs: [
      { id:"ercot-ecr",  name:"Emergency Curtailment Rider",    type:"DR",  earnings:"Varies by program", enrolled:false },
      { id:"ercot-4cp",  name:"4-Coincident Peak Avoidance",    type:"4CP", earnings:"Varies by program", enrolled:false },
      { id:"ercot-ancil",name:"Ancillary Services (via aggregator)",type:"AS",earnings:"Varies by program", enrolled:false },
    ]
  },
  PJM: {
    iso: "PJM",
    programs: [
      { id:"pjm-dr",     name:"PJM Demand Response",            type:"DR",  earnings:"Varies by program", enrolled:false },
      { id:"pjm-esr",    name:"Emergency Load Response",        type:"DR",  earnings:"Varies by program", enrolled:false },
      { id:"pjm-csr",    name:"Capacity Storage Resource",      type:"Capacity",earnings:"Varies by program", enrolled:false },
    ]
  },
  MISO: {
    iso: "MISO",
    programs: [
      { id:"miso-dr",    name:"MISO Demand Response",           type:"DR",  earnings:"Varies by program", enrolled:false },
      { id:"miso-vsr",   name:"Voluntary Store Resource",       type:"Storage",earnings:"Varies by program", enrolled:false },
    ]
  },
  NYISO: {
    iso: "NYISO",
    programs: [
      { id:"nyiso-dr",   name:"NYISO Demand Response Programs", type:"DR",  earnings:"Varies by program", enrolled:false },
      { id:"nyiso-cms",  name:"Demand Curve Demand Response",   type:"Capacity",earnings:"Varies by program", enrolled:false },
    ]
  },
  ISONE: {
    iso: "ISONE",
    programs: [
      { id:"isone-dr",   name:"ISO-NE Real-Time Demand Response",type:"DR", earnings:"Varies by program", enrolled:false },
      { id:"isone-fcm",  name:"Forward Capacity Market",        type:"Capacity",earnings:"Varies by program", enrolled:false },
    ]
  },
};

// ─── MAIN GEO INTELLIGENCE PIPELINE ──────────────────────────────────────────
/**
 * Full pipeline: given an address, return complete opportunity profile.
 *
 * @param {object} input - { address?, zip?, lat?, lng? }
 * @returns {object} Complete geo intelligence profile
 */
export async function getGeoIntelligence(input = {}) {
  const { address, zip, lat: inputLat, lng: inputLng } = input;

  // ── Step 1: Geocode ──────────────────────────────────────────────────────────
  let lat = inputLat;
  let lng = inputLng;
  let geoData = {};

  if (!lat && address) {
    geoData = await geocodeAddress(address);
    lat = geoData.lat;
    lng = geoData.lng;
  } else if (!lat && zip) {
    const zipData = await prisma.zipCode.findUnique({ where: { zip } });
    if (zipData) { lat = zipData.lat; lng = zipData.lng; geoData = zipData; }
  }

  if (!lat || !lng) {
    return { error: "Could not geocode location", input };
  }

  const state = geoData.state || input.state || "";
  const cacheKey = `geo-intel:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  // ── Step 2: Identify Utility ─────────────────────────────────────────────────
  const utility = await identifyUtility(lat, lng, zip || geoData.zip, state);

  // ── Step 3: Identify ISO/RTO ─────────────────────────────────────────────────
  const iso = identifyISO(state, utility);

  // ── Step 4: State incentives ──────────────────────────────────────────────────
  const incentives = await getStateIncentives(state);

  // ── Step 5: Utility-specific incentives ──────────────────────────────────────
  const utilityIncentives = utility ? getUtilityIncentives(utility) : [];

  // ── Step 6: VPP programs available ───────────────────────────────────────────
  const vppPrograms = getVPPPrograms(iso?.iso, utility);

  // ── Step 7: Find nearby installers ───────────────────────────────────────────
  let installers = [];
  try {
    installers = await findNearbyInstallers({ lat, lng, radiusMiles: 50, limit: 5 });
  } catch { /* non-fatal */ }

  // ── Step 8: Assemble opportunity profile ─────────────────────────────────────
  const profile = {
    location: {
      lat, lng,
      address:  geoData.formatted || address,
      city:     geoData.city,
      state,
      zip:      geoData.zip || zip,
      county:   geoData.county,
      country:  "US",
    },
    utility: utility ? {
      name:      utility.name || utility.short,
      shortName: utility.short || utility.shortName,
      eiaid:     utility.eiaid,
      type:      utility.type,
      state:     utility.state,
      phone:     utility.contact,
      website:   utility.website,
      customerPortalUrl: utility.customerPortalUrl || null,
      vppReady:  utility.vpp || false,
      drEnabled: utility.dr || false,
      touRates:  utility.touRates || false,
      netMetering: utility.netMetering || false,
      evRate:    utility.evRate || null,
      programs:  utility.programs || [],
      ratePlans: utility.ratePlans || [],
      // Phase 2: recommended connection method (Green Button -> Arcadia -> direct API -> manual)
      connection: utility.connection || resolveConnectionMethod(utility),
      dataSource: utility.source || "unknown",
    } : null,
    iso: iso || { iso: "Unknown", name: "Grid operator not identified for this location" },
    incentives: {
      federal:  incentives.filter(i => i.type.startsWith("federal")),
      state:    incentives.filter(i => i.type.startsWith("state") || i.type === "net_metering" || i.type === "renewable_credit"),
      utility:  utilityIncentives,
      total:    incentives.length + utilityIncentives.length,
      estimatedValue: estimateTotalIncentives(incentives.concat(utilityIncentives), input.systemSizeKw || 8),
    },
    vpp: {
      eligible: !!(utility?.vpp),
      iso:      iso?.iso || "Unknown",
      programs: vppPrograms,
      estimatedAnnualEarnings: estimateVPPEarnings(vppPrograms),
    },
    installers: {
      count:      installers.length,
      nearby:     installers.slice(0, 3),
      searchRadius: 50,
    },
    summary: buildOpportunitySummary({ utility, iso, incentives, vppPrograms, installers }),
    generatedAt: new Date().toISOString(),
  };

  await cacheSet(cacheKey, profile, 3600); // Cache 1 hour
  return profile;
}

// ─── UTILITY IDENTIFICATION ───────────────────────────────────────────────────
async function identifyUtility(lat, lng, zip, state) {
  const include = { programs: { where: { isActive: true } }, incentives: { where: { isActive: true } }, ratePlans: { where: { isActive: true } } };

  // 1. Try database lookup first (most accurate — uses polygon data)
  try {
    const dbUtility = await prisma.utilityTerritory.findFirst({
      where: {
        isActive: true,
        minLat: { lte: lat }, maxLat: { gte: lat },
        minLng: { lte: lng }, maxLng: { gte: lng },
      },
      include,
    });
    if (dbUtility) return normalizeDbUtility(dbUtility);
  } catch { /* non-fatal */ }

  // 2. ZIP-based lookup from ZIP code table
  if (zip) {
    try {
      const zipData = await prisma.zipCode.findUnique({
        where: { zip },
        include: { utility: { include } },
      });
      if (zipData?.utility?.isActive) return normalizeDbUtility(zipData.utility);
    } catch { /* non-fatal */ }
  }

  // 3. State-wide DB lookup (any active utility on file for this state).
  //    If there's exactly one for the state, that's an unambiguous match.
  //    With multiple utilities and no polygon/ZIP match, we don't have enough
  //    signal from the DB alone yet — fall through to the ZIP-prefix heuristic.
  try {
    const stateUtilities = await prisma.utilityTerritory.findMany({ where: { state, isActive: true }, include });
    if (stateUtilities.length === 1) return normalizeDbUtility(stateUtilities[0]);
  } catch { /* non-fatal */ }

  // 4. Legacy hardcoded master list — kept as a fallback for states/utilities not
  //    yet loaded into the database (see prisma/seed-utilities.js to add more).
  const stateUtilities = UTILITY_MASTER.filter((u) => u.state === state);
  if (stateUtilities.length === 1) return { ...stateUtilities[0], source: "hardcoded_fallback" };

  if (zip) {
    const zipPrefix = zip.substring(0, 2);
    const match = UTILITY_MASTER.find((u) => u.state === state && u.zipPrefixes?.includes(zipPrefix));
    if (match) return { ...match, source: "hardcoded_fallback" };
  }

  return stateUtilities[0] ? { ...stateUtilities[0], source: "hardcoded_fallback" } : null;
}

// Normalizes a UtilityTerritory DB row (+ its programs/incentives/ratePlans relations)
// into the flatter shape the rest of this pipeline (and UTILITY_MASTER fallback entries)
// already use, so downstream code doesn't need two branches. Also attaches the Phase 2
// connection-method recommendation directly on the utility object.
function normalizeDbUtility(dbUtility) {
  return {
    id: dbUtility.id,
    name: dbUtility.name,
    short: dbUtility.shortName,
    shortName: dbUtility.shortName,
    eiaid: dbUtility.eiaid,
    type: dbUtility.type,
    state: dbUtility.state,
    iso: dbUtility.iso || null,
    contact: dbUtility.phone,
    website: dbUtility.website,
    customerPortalUrl: dbUtility.customerPortalUrl,
    vpp: dbUtility.vppEligible,
    dr: dbUtility.demandResponseAvailable,
    touRates: dbUtility.touRatesAvailable,
    netMetering: dbUtility.netMeteringAvailable,
    programs: (dbUtility.programs || []).map((p) => p.name),
    programDetails: dbUtility.programs || [],
    incentives: (dbUtility.incentives || []).map((i) => ({
      id: i.id, name: i.name, type: i.category.toLowerCase(), value: i.value,
      estimatedDollarValue: i.estimatedDollarValue, stackable: i.stackable,
    })),
    ratePlans: dbUtility.ratePlans || [],
    connection: resolveConnectionMethod(dbUtility),
    source: "database",
  };
}

// ─── ISO IDENTIFICATION ───────────────────────────────────────────────────────
function identifyISO(state, utility) {
  // If utility has ISO specified, use that
  if (utility?.iso) {
    const isoKey = utility.iso;
    return {
      iso:     isoKey,
      name:    VPP_PROGRAMS[isoKey]?.iso || isoKey,
      fullName: STATE_ISO[state]?.name || isoKey,
      website: STATE_ISO[state]?.website || null,
      hasVPP:  isoKey in VPP_PROGRAMS,
    };
  }
  // Fall back to state map
  const stateISO = STATE_ISO[state];
  if (stateISO) {
    return { ...stateISO, hasVPP: stateISO.iso in VPP_PROGRAMS };
  }
  return null;
}

// ─── INCENTIVE LOOKUP ─────────────────────────────────────────────────────────
async function getStateIncentives(state) {
  try {
    const dbIncentives = await prisma.utilityIncentive.findMany({
      where: { state, utilityId: null, isActive: true },
    });
    if (dbIncentives.length) {
      return dbIncentives.map((i) => ({
        id: i.id, name: i.name, type: i.category.toLowerCase(), value: i.value,
        estimatedDollarValue: i.estimatedDollarValue, expires: i.expiresOn ? i.expiresOn.getFullYear().toString() : null,
        stackable: i.stackable,
      }));
    }
  } catch { /* non-fatal — fall back to hardcoded list below */ }

  const stateSpecific = STATE_INCENTIVES[state] || [];
  const federal       = STATE_INCENTIVES.DEFAULT || [];
  // Merge — state overrides federal duplicates
  const all = [...federal];
  for (const inc of stateSpecific) {
    if (!all.find(f => f.id === inc.id)) all.push(inc);
  }
  return all;
}

function getUtilityIncentives(utility) {
  // Prefer incentives already attached by identifyUtility()/normalizeDbUtility() —
  // these come straight from the UtilityIncentive table for this specific utility.
  if (utility?.incentives?.length) return utility.incentives;

  const utilityShort = utility?.short || utility?.shortName;
  const utilityIncentives = {
    "PG&E":    [{ id:"pge-sge", name:"PG&E Solar Generation Export Credit",   type:"utility_rebate", value:"Export rates per kWh" }],
    "SCE":     [{ id:"sce-res", name:"SCE Residential Battery Incentive",      type:"utility_rebate", value:"$250/kWh installed" }],
    "SDG&E":   [{ id:"sdge-ev", name:"SDG&E EV Charging Incentive",            type:"utility_rebate", value:"Up to $500" }],
    "Duke IN": [{ id:"dkIn-ac", name:"Duke IN AC Cycling Rebate",              type:"utility_rebate", value:"$40/season" },
                { id:"dkIn-bat",name:"Duke IN Battery Program",                type:"utility_rebate", value:"$300 enrollment bonus" }],
    "AES IN":  [{ id:"aes-ev",  name:"AES Indiana EV Charger Rebate",          type:"utility_rebate", value:"Up to $500" },
                { id:"aes-bat", name:"AES EnergyConnect Battery Program",      type:"utility_rebate", value:"Monthly payments" }],
    "I&M":     [{ id:"im-eff",  name:"I&M Energy Efficiency Rebates",          type:"utility_rebate", value:"Up to $1,200" }],
    "Xcel":    [{ id:"xcel-sol",name:"Xcel Solar*Rewards",                     type:"utility_rebate", value:"$0.09/kWh solar credit" },
                { id:"xcel-bat",name:"Xcel Battery Incentive",                 type:"utility_rebate", value:"$250/kWh installed" }],
    "ComEd":   [{ id:"comed-ev",name:"ComEd EV Charger Rebate",               type:"utility_rebate", value:"Up to $750" }],
    "FPL":     [{ id:"fpl-sol", name:"FPL SolarNow",                           type:"utility_rebate", value:"Community solar subscription" }],
    "ConEd":   [{ id:"coned-bat",name:"ConEd Battery Reward Program",          type:"utility_rebate", value:"$350+/kW enrolled" }],
  };
  return utilityIncentives[utilityShort] || [];
}

// ─── VPP PROGRAMS ─────────────────────────────────────────────────────────────
function getVPPPrograms(isoKey, utility) {
  const programs = [];
  if (isoKey && VPP_PROGRAMS[isoKey]) {
    programs.push(...VPP_PROGRAMS[isoKey].programs);
  }

  // DB-backed utilities have real program rows with a category — use those directly.
  if (utility?.programDetails?.length) {
    for (const prog of utility.programDetails) {
      if (prog.category === "VPP" || prog.category === "DEMAND_RESPONSE") {
        programs.push({
          id: `util-${prog.id}`, name: prog.name, type: prog.category === "VPP" ? "VPP" : "DR",
          earnings: "Varies", enrolled: false, source: "utility", description: prog.description, url: prog.url,
        });
      }
    }
    return programs;
  }

  // Hardcoded-fallback utilities only have a flat array of program name strings —
  // fall back to keyword matching to guess which ones are DR/VPP related.
  if (utility?.programs) {
    for (const prog of utility.programs) {
      if (prog.toLowerCase().includes("demand") || prog.toLowerCase().includes("dr") || prog.toLowerCase().includes("vpp")) {
        programs.push({ id: `util-${prog.toLowerCase().replace(/\s+/g,"-")}`, name: prog, type: "DR", earnings: "Varies", enrolled: false, source: "utility" });
      }
    }
  }
  return programs;
}

// ─── EARNINGS ESTIMATOR ───────────────────────────────────────────────────────
// No dollar estimate is produced here. This used to regex-parse the made-up
// "$100-400/event" strings above into a synthesized "$X-Y/yr" range that was
// shown on the public, unauthenticated signup address preview. Verified,
// admin-published estimates (VppProgramEarningsEstimate) are the only source
// of VPP earnings figures shown to users.
function estimateVPPEarnings() {
  return null;
}

function estimateTotalIncentives(incentives, systemSizeKw = 8) {
  const systemCost = systemSizeKw * 2800; // ~$2,800/kW average
  let estimatedValue = 0;
  for (const inc of incentives) {
    if (typeof inc.estimatedDollarValue === "number") {
      // DB-sourced incentive with a concrete admin-set value — use it directly.
      estimatedValue += inc.estimatedDollarValue;
      continue;
    }
    // Fallback heuristic for hardcoded entries that only have a human-readable string.
    if (inc.type === "federal_tax_credit" && inc.value.includes("30%")) estimatedValue += systemCost * 0.30;
    if (inc.type === "state_tax_credit" && inc.value.includes("25%")) estimatedValue += Math.min(systemCost * 0.25, 5000);
    if (inc.type === "state_rebate" && inc.value.includes("kWh")) estimatedValue += systemSizeKw * 250;
  }
  return { estimatedTotal: Math.round(estimatedValue), currency: "USD", systemSizeKw };
}

// ─── OPPORTUNITY SUMMARY ─────────────────────────────────────────────────────
function buildOpportunitySummary({ utility, iso, incentives, vppPrograms, installers }) {
  const items = [];
  if (utility?.vpp) items.push(`VPP eligible via ${utility.short || utility.shortName}`);
  if (iso)          items.push(`Grid: ${iso.iso} — ${iso.fullName || iso.name}`);
  if (incentives.length) items.push(`${incentives.length} incentive programs available`);
  if (vppPrograms.length) items.push(`${vppPrograms.length} VPP/DR programs`);
  if (installers.length) items.push(`${installers.length} GridGuide-certified installers within 50 miles`);
  return items;
}

// ─── INSTALLER SERVICE AREA ───────────────────────────────────────────────────
/**
 * Check if a given lat/lng falls within an installer's service area.
 * Service area defined by ZIP codes, radius, or state list.
 */
export async function isInInstallerServiceArea(installerId, lat, lng, zip) {
  const installer = await prisma.installer.findUnique({
    where:   { id: installerId },
    include: { serviceArea: true },
  });
  if (!installer) return false;

  const sa = installer.serviceArea;
  if (!sa) return false;

  // Check explicit ZIP list
  if (sa.zipCodes?.length && zip && sa.zipCodes.includes(zip)) return true;

  // Check state list
  if (sa.states?.length) {
    const zipData = zip ? await prisma.zipCode.findUnique({ where: { zip } }) : null;
    if (zipData && sa.states.includes(zipData.state)) return true;
  }

  // Check radius
  if (sa.centerLat && sa.centerLng && sa.radiusMiles) {
    const { haversineDistance } = await import("./geo.js");
    const dist = haversineDistance(lat, lng, sa.centerLat, sa.centerLng);
    if (dist <= sa.radiusMiles) return true;
  }

  return false;
}

/**
 * Get installer's formatted service area description
 */
export function describeServiceArea(serviceArea) {
  if (!serviceArea) return "Service area not specified";
  const parts = [];
  if (serviceArea.states?.length)    parts.push(serviceArea.states.join(", "));
  if (serviceArea.radiusMiles)       parts.push(`${serviceArea.radiusMiles}-mile radius`);
  if (serviceArea.zipCodes?.length)  parts.push(`${serviceArea.zipCodes.length} ZIP codes`);
  return parts.join(" · ") || "Contact for service area";
}

export { UTILITY_MASTER, STATE_ISO, STATE_INCENTIVES, VPP_PROGRAMS };
