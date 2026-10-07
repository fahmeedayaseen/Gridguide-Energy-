/**
 * GridGuide — Geo Seed Data
 *
 * Seeds the database with:
 *  1. Major US ZIP codes for 10 largest metro areas
 *  2. Electric utility territories for those markets
 *
 * In production, replace with the full USPS ZIP code database (~42,000 ZIPs)
 * and EIA utility territory shapefiles (available at eia.gov).
 *
 * Run: node prisma/seed-geo.js
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// ─── Utility territories ───────────────────────────────────────────────────────
const UTILITIES = [
  { shortName:"PG&E",   name:"Pacific Gas and Electric",        state:"CA", type:"IOU", eiaid:"14328", minLat:36.4, maxLat:42.0, minLng:-124.4, maxLng:-119.0 },
  { shortName:"SCE",    name:"Southern California Edison",       state:"CA", type:"IOU", eiaid:"17609", minLat:32.5, maxLat:37.0, minLng:-121.0, maxLng:-114.5 },
  { shortName:"SDG&E",  name:"San Diego Gas & Electric",         state:"CA", type:"IOU", eiaid:"16609", minLat:32.4, maxLat:33.5, minLng:-117.6, maxLng:-116.0 },
  { shortName:"LADWP",  name:"Los Angeles Department of Water and Power", state:"CA", type:"Municipal", eiaid:"11208", minLat:33.7, maxLat:34.4, minLng:-118.7, maxLng:-118.1 },
  { shortName:"Xcel",   name:"Xcel Energy",                      state:"TX", type:"IOU", eiaid:"20816", minLat:25.8, maxLat:36.5, minLng:-106.6, maxLng:-93.5 },
  { shortName:"APS",    name:"Arizona Public Service",            state:"AZ", type:"IOU", eiaid:"803",   minLat:31.3, maxLat:37.0, minLng:-114.8, maxLng:-109.0 },
  { shortName:"Duke",   name:"Duke Energy Carolinas",             state:"NC", type:"IOU", eiaid:"5416",  minLat:33.8, maxLat:36.6, minLng:-84.3, maxLng:-79.0 },
  { shortName:"FPL",    name:"Florida Power & Light",             state:"FL", type:"IOU", eiaid:"6452",  minLat:24.4, maxLat:30.8, minLng:-87.6, maxLng:-79.9 },
  { shortName:"ComEd",  name:"Commonwealth Edison",               state:"IL", type:"IOU", eiaid:"3755",  minLat:40.4, maxLat:42.5, minLng:-91.5, maxLng:-87.0 },
  { shortName:"ConEd",  name:"Consolidated Edison",               state:"NY", type:"IOU", eiaid:"3756",  minLat:40.4, maxLat:41.1, minLng:-74.3, maxLng:-73.6 },
];

// ─── ZIP codes for major metro areas ──────────────────────────────────────────
const ZIP_CODES = [
  // San Francisco Bay Area (PG&E)
  { zip:"94102", city:"San Francisco",   state:"CA", lat:37.7749, lng:-122.4194, county:"San Francisco" },
  { zip:"94103", city:"San Francisco",   state:"CA", lat:37.7726, lng:-122.4109, county:"San Francisco" },
  { zip:"94105", city:"San Francisco",   state:"CA", lat:37.7879, lng:-122.3923, county:"San Francisco" },
  { zip:"94107", city:"San Francisco",   state:"CA", lat:37.7647, lng:-122.3997, county:"San Francisco" },
  { zip:"94110", city:"San Francisco",   state:"CA", lat:37.7509, lng:-122.4153, county:"San Francisco" },
  { zip:"94115", city:"San Francisco",   state:"CA", lat:37.7854, lng:-122.4376, county:"San Francisco" },
  { zip:"94117", city:"San Francisco",   state:"CA", lat:37.7695, lng:-122.4466, county:"San Francisco" },
  { zip:"94122", city:"San Francisco",   state:"CA", lat:37.7600, lng:-122.4780, county:"San Francisco" },
  { zip:"94131", city:"San Francisco",   state:"CA", lat:37.7424, lng:-122.4379, county:"San Francisco" },
  { zip:"94158", city:"San Francisco",   state:"CA", lat:37.7702, lng:-122.3895, county:"San Francisco" },
  { zip:"94501", city:"Alameda",         state:"CA", lat:37.7652, lng:-122.2416, county:"Alameda" },
  { zip:"94601", city:"Oakland",         state:"CA", lat:37.7747, lng:-122.2177, county:"Alameda" },
  { zip:"94605", city:"Oakland",         state:"CA", lat:37.7432, lng:-122.1671, county:"Alameda" },
  { zip:"94702", city:"Berkeley",        state:"CA", lat:37.8750, lng:-122.2830, county:"Alameda" },
  { zip:"94044", city:"Pacifica",        state:"CA", lat:37.6138, lng:-122.4869, county:"San Mateo" },
  { zip:"94025", city:"Menlo Park",      state:"CA", lat:37.4529, lng:-122.1817, county:"San Mateo" },
  { zip:"95126", city:"San Jose",        state:"CA", lat:37.3352, lng:-121.9114, county:"Santa Clara" },
  { zip:"95128", city:"San Jose",        state:"CA", lat:37.3118, lng:-121.9290, county:"Santa Clara" },

  // Los Angeles (SCE / LADWP)
  { zip:"90001", city:"Los Angeles",     state:"CA", lat:33.9731, lng:-118.2479, county:"Los Angeles" },
  { zip:"90012", city:"Los Angeles",     state:"CA", lat:34.0578, lng:-118.2378, county:"Los Angeles" },
  { zip:"90025", city:"Los Angeles",     state:"CA", lat:34.0368, lng:-118.4474, county:"Los Angeles" },
  { zip:"90210", city:"Beverly Hills",   state:"CA", lat:34.0901, lng:-118.4065, county:"Los Angeles" },
  { zip:"90291", city:"Venice",          state:"CA", lat:33.9979, lng:-118.4648, county:"Los Angeles" },
  { zip:"90401", city:"Santa Monica",    state:"CA", lat:34.0195, lng:-118.4912, county:"Los Angeles" },
  { zip:"91106", city:"Pasadena",        state:"CA", lat:34.1478, lng:-118.1063, county:"Los Angeles" },
  { zip:"91506", city:"Burbank",         state:"CA", lat:34.1794, lng:-118.3250, county:"Los Angeles" },

  // San Diego (SDG&E)
  { zip:"92101", city:"San Diego",       state:"CA", lat:32.7157, lng:-117.1611, county:"San Diego" },
  { zip:"92103", city:"San Diego",       state:"CA", lat:32.7439, lng:-117.1596, county:"San Diego" },
  { zip:"92109", city:"San Diego",       state:"CA", lat:32.7916, lng:-117.2341, county:"San Diego" },
  { zip:"92121", city:"San Diego",       state:"CA", lat:32.8928, lng:-117.2021, county:"San Diego" },
  { zip:"92127", city:"San Diego",       state:"CA", lat:32.9965, lng:-117.0877, county:"San Diego" },

  // Austin, TX (Xcel / Austin Energy)
  { zip:"78701", city:"Austin",          state:"TX", lat:30.2672, lng:-97.7431, county:"Travis" },
  { zip:"78702", city:"Austin",          state:"TX", lat:30.2590, lng:-97.7152, county:"Travis" },
  { zip:"78704", city:"Austin",          state:"TX", lat:30.2449, lng:-97.7680, county:"Travis" },
  { zip:"78745", city:"Austin",          state:"TX", lat:30.2103, lng:-97.7856, county:"Travis" },
  { zip:"78750", city:"Austin",          state:"TX", lat:30.3961, lng:-97.7540, county:"Travis" },
  { zip:"78759", city:"Austin",          state:"TX", lat:30.3851, lng:-97.7329, county:"Travis" },

  // Phoenix, AZ (APS)
  { zip:"85001", city:"Phoenix",         state:"AZ", lat:33.4484, lng:-112.0740, county:"Maricopa" },
  { zip:"85004", city:"Phoenix",         state:"AZ", lat:33.4514, lng:-112.0682, county:"Maricopa" },
  { zip:"85016", city:"Phoenix",         state:"AZ", lat:33.4858, lng:-112.0190, county:"Maricopa" },
  { zip:"85254", city:"Scottsdale",      state:"AZ", lat:33.5981, lng:-111.9372, county:"Maricopa" },

  // Charlotte, NC (Duke Energy)
  { zip:"28202", city:"Charlotte",       state:"NC", lat:35.2271, lng:-80.8431, county:"Mecklenburg" },
  { zip:"28203", city:"Charlotte",       state:"NC", lat:35.2091, lng:-80.8528, county:"Mecklenburg" },
  { zip:"28205", city:"Charlotte",       state:"NC", lat:35.2208, lng:-80.7953, county:"Mecklenburg" },

  // Miami, FL (FPL)
  { zip:"33101", city:"Miami",           state:"FL", lat:25.7617, lng:-80.1918, county:"Miami-Dade" },
  { zip:"33125", city:"Miami",           state:"FL", lat:25.7790, lng:-80.2295, county:"Miami-Dade" },
  { zip:"33139", city:"Miami Beach",     state:"FL", lat:25.7889, lng:-80.1300, county:"Miami-Dade" },

  // Chicago, IL (ComEd)
  { zip:"60601", city:"Chicago",         state:"IL", lat:41.8827, lng:-87.6228, county:"Cook" },
  { zip:"60605", city:"Chicago",         state:"IL", lat:41.8628, lng:-87.6194, county:"Cook" },
  { zip:"60614", city:"Chicago",         state:"IL", lat:41.9229, lng:-87.6512, county:"Cook" },
  { zip:"60625", city:"Chicago",         state:"IL", lat:41.9717, lng:-87.7026, county:"Cook" },

  // New York, NY (ConEd)
  { zip:"10001", city:"New York",        state:"NY", lat:40.7484, lng:-73.9967, county:"New York" },
  { zip:"10002", city:"New York",        state:"NY", lat:40.7157, lng:-73.9863, county:"New York" },
  { zip:"10012", city:"New York",        state:"NY", lat:40.7256, lng:-74.0017, county:"New York" },
  { zip:"10014", city:"New York",        state:"NY", lat:40.7337, lng:-74.0058, county:"New York" },
  { zip:"11201", city:"Brooklyn",        state:"NY", lat:40.6936, lng:-73.9878, county:"Kings" },
  { zip:"11211", city:"Brooklyn",        state:"NY", lat:40.7119, lng:-73.9514, county:"Kings" },
  { zip:"11215", city:"Brooklyn",        state:"NY", lat:40.6608, lng:-73.9839, county:"Kings" },
];

async function main() {
  console.log("🌱 Seeding geo data...");

  // Seed utilities
  let utilitiesCreated = 0;
  const utilityMap = {};

  for (const util of UTILITIES) {
    const record = await prisma.utilityTerritory.upsert({
      where:  { eiaid: util.eiaid },
      update: util,
      create: util,
    });
    utilityMap[util.shortName] = record.id;
    utilitiesCreated++;
  }
  console.log(`✓ ${utilitiesCreated} utility territories seeded`);

  // Map ZIP codes to their utilities
  const zipUtilityMap = {
    // CA - Bay Area → PG&E
    ...Object.fromEntries(
      ZIP_CODES.filter(z => z.state === "CA" && z.lat > 36.4).map(z => [z.zip, "PG&E"])
    ),
    // CA - San Diego → SDG&E
    ...Object.fromEntries(
      ZIP_CODES.filter(z => z.city === "San Diego" || z.zip.startsWith("921")).map(z => [z.zip, "SDG&E"])
    ),
    // CA - LA (LADWP core)
    "90001":"LADWP","90012":"LADWP","90025":"LADWP","90210":"LADWP","90291":"LADWP","90401":"LADWP",
    // CA - LA suburbs → SCE
    "91106":"SCE","91506":"SCE",
    // TX → Xcel
    ...Object.fromEntries(ZIP_CODES.filter(z => z.state === "TX").map(z => [z.zip, "Xcel"])),
    // AZ → APS
    ...Object.fromEntries(ZIP_CODES.filter(z => z.state === "AZ").map(z => [z.zip, "APS"])),
    // NC → Duke
    ...Object.fromEntries(ZIP_CODES.filter(z => z.state === "NC").map(z => [z.zip, "Duke"])),
    // FL → FPL
    ...Object.fromEntries(ZIP_CODES.filter(z => z.state === "FL").map(z => [z.zip, "FPL"])),
    // IL → ComEd
    ...Object.fromEntries(ZIP_CODES.filter(z => z.state === "IL").map(z => [z.zip, "ComEd"])),
    // NY → ConEd
    ...Object.fromEntries(ZIP_CODES.filter(z => z.state === "NY").map(z => [z.zip, "ConEd"])),
  };

  // Seed ZIP codes
  let zipsCreated = 0;
  for (const zip of ZIP_CODES) {
    const utilityShort = zipUtilityMap[zip.zip];
    const utilityId    = utilityShort ? utilityMap[utilityShort] : null;

    await prisma.zipCode.upsert({
      where:  { zip: zip.zip },
      update: { ...zip, utilityId },
      create: { ...zip, utilityId },
    });
    zipsCreated++;
  }
  console.log(`✓ ${zipsCreated} ZIP codes seeded`);

  console.log(`
✅ Geo seeding complete!

Production: Replace with full datasets:
  • USPS ZIP+4 database (~42,000 ZIP codes)  
  • EIA utility territory shapefiles (eia.gov/maps)
  • Use PostGIS ST_Contains for precise territory boundary matching
  `);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
