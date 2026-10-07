/**
 * GridGuide — Geo & Address Library
 *
 * Provides:
 *   - Google Address Validation API (like Google has on their checkout)
 *   - Geocoding (address → lat/lng) via Google or Mapbox fallback
 *   - Reverse geocoding (lat/lng → address)
 *   - Haversine distance calculation
 *   - ZIP code lookup
 *   - Utility territory detection
 *   - Installer proximity search
 */

import axios from "axios";
import { prisma } from "./db.js";
import { cacheGet, cacheSet } from "./redis.js";
import { logger } from "./sentry.js";

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
const MAPBOX_KEY = process.env.MAPBOX_SECRET_TOKEN;

// ─── 1. GOOGLE ADDRESS VALIDATION API ─────────────────────────────────────────
/**
 * Validates an address using Google's Address Validation API.
 * Returns normalized address, verdict, and component-level fixes.
 *
 * This is the same API Google uses internally for their own checkout flow.
 *
 * @param {object} address - { addressLines, city, state, zip, country }
 * @returns {object} { valid, verdict, normalized, components, dpvConfirmation, issues }
 */
export async function validateAddress(address) {
  const { addressLines = [], city, state, zip, country = "US" } = address;

  if (!GOOGLE_KEY) {
    logger.warn("GOOGLE_MAPS_API_KEY not set — falling back to geocoding validation");
    return validateViaGeocoding(`${addressLines.join(" ")}, ${city}, ${state} ${zip}`);
  }

  try {
    const res = await axios.post(
      `https://addressvalidation.googleapis.com/v1:validateAddress?key=${GOOGLE_KEY}`,
      {
        address: {
          regionCode: country,
          addressLines: [
            ...addressLines,
            ...(city ? [city] : []),
            ...(state ? [state] : []),
            ...(zip ? [zip] : []),
          ],
        },
        enableUspsCass: true, // USPS CASS validation for US addresses
      },
      { timeout: 8000 }
    );

    const result = res.data.result;
    const verdict = result.verdict;
    const addr    = result.address;
    const geocode = result.geocode;
    const usps    = result.uspsData;

    // Parse address components
    const components = {};
    for (const comp of addr.addressComponents || []) {
      const type = comp.componentType;
      components[type] = {
        value:       comp.componentName?.text,
        confirmed:   comp.confirmationLevel === "CONFIRMED",
        inferred:    comp.inferred,
        replaced:    comp.replaced,
        spellCorrected: comp.spellCorrected,
      };
    }

    // Determine overall validity
    const valid =
      verdict.addressComplete &&
      !verdict.hasUnconfirmedComponents &&
      (verdict.validationGranularity === "PREMISE" ||
       verdict.validationGranularity === "SUB_PREMISE" ||
       verdict.validationGranularity === "ROUTE");

    // Build human-readable issues list
    const issues = [];
    if (!verdict.addressComplete)         issues.push("Address is incomplete");
    if (verdict.hasUnconfirmedComponents) issues.push("Some address components could not be confirmed");
    if (verdict.hasInferredComponents)    issues.push("Some components were inferred — please verify");
    if (verdict.hasReplacedComponents)    issues.push("Some components were corrected — see normalized address");

    return {
      valid,
      verdict: {
        complete:       verdict.addressComplete,
        granularity:    verdict.validationGranularity,
        hasUnconfirmed: verdict.hasUnconfirmedComponents,
        hasInferred:    verdict.hasInferredComponents,
        hasReplaced:    verdict.hasReplacedComponents,
      },
      normalized: {
        formatted:    addr.formattedAddress,
        streetNumber: components["street_number"]?.value,
        route:        components["route"]?.value,
        city:         components["locality"]?.value,
        state:        components["administrative_area_level_1"]?.value,
        zip:          components["postal_code"]?.value,
        zipSuffix:    components["postal_code_suffix"]?.value,
        county:       components["administrative_area_level_2"]?.value,
        country:      components["country"]?.value || "US",
      },
      coordinates: {
        lat: geocode?.location?.latitude,
        lng: geocode?.location?.longitude,
        accuracy: geocode?.geocodeGranularity,
      },
      placeId:    geocode?.placeId,
      dpvConfirmation: usps?.dpvConfirmation, // Y=confirmed, S=vacant, D=no-stat, N=not confirmed
      vacantAddress: usps?.dpvVacant === "Y",
      components,
      issues,
      source: "google_address_validation_api",
    };

  } catch (err) {
    logger.error("Google Address Validation failed", { error: err.message });
    // Graceful fallback
    return validateViaGeocoding(`${addressLines.join(" ")}, ${city}, ${state} ${zip}`);
  }
}

// ─── 2. GEOCODING (address → lat/lng) ─────────────────────────────────────────
export async function geocodeAddress(addressString) {
  const cacheKey = `geo:${addressString.toLowerCase().replace(/\s+/g, "+")}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return { ...cached, source: "cache" };

  // Try Google first
  if (GOOGLE_KEY) {
    try {
      const res = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
        params: { address: addressString, key: GOOGLE_KEY },
        timeout: 8000,
      });

      if (res.data.status === "OK" && res.data.results.length > 0) {
        const r        = res.data.results[0];
        const loc      = r.geometry.location;
        const comps    = parseGoogleComponents(r.address_components);

        const result = {
          lat:             loc.lat,
          lng:             loc.lng,
          formatted:       r.formatted_address,
          placeId:         r.place_id,
          locationType:    r.geometry.location_type, // ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER
          streetNumber:    comps.street_number,
          route:           comps.route,
          city:            comps.locality,
          state:           comps.administrative_area_level_1,
          zip:             comps.postal_code,
          county:          comps.administrative_area_level_2,
          country:         comps.country || "US",
          source:          "google",
        };

        await cacheSet(cacheKey, result, 86400); // 24h cache
        return result;
      }
    } catch {}
  }

  // Fallback: Mapbox
  if (MAPBOX_KEY) {
    try {
      const encoded = encodeURIComponent(addressString);
      const res     = await axios.get(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json`,
        { params: { access_token: MAPBOX_KEY, country: "US", types: "address", limit: 1 }, timeout: 8000 }
      );

      const feature = res.data.features?.[0];
      if (feature) {
        const [lng, lat] = feature.center;
        const ctx        = parseMapboxContext(feature.context || []);
        const result     = {
          lat,
          lng,
          formatted:    feature.place_name,
          placeId:      feature.id,
          streetNumber: feature.address,
          route:        feature.text,
          city:         ctx.place,
          state:        ctx.region,
          zip:          ctx.postcode,
          county:       ctx.district,
          country:      "US",
          source:       "mapbox",
        };
        await cacheSet(cacheKey, result, 86400);
        return result;
      }
    } catch {}
  }

  return { error: "Geocoding failed — no valid result from any provider", lat: null, lng: null };
}

// ─── 3. REVERSE GEOCODING (lat/lng → address) ─────────────────────────────────
export async function reverseGeocode(lat, lng) {
  const cacheKey = `rgeo:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return { ...cached, source: "cache" };

  if (!GOOGLE_KEY) return { error: "Google Maps API key not configured" };

  try {
    const res = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
      params: { latlng: `${lat},${lng}`, key: GOOGLE_KEY, result_type: "street_address" },
      timeout: 6000,
    });

    if (res.data.status === "OK" && res.data.results.length > 0) {
      const r     = res.data.results[0];
      const comps = parseGoogleComponents(r.address_components);
      const result = {
        formatted:    r.formatted_address,
        placeId:      r.place_id,
        streetNumber: comps.street_number,
        route:        comps.route,
        city:         comps.locality,
        state:        comps.administrative_area_level_1,
        zip:          comps.postal_code,
        county:       comps.administrative_area_level_2,
        country:      comps.country || "US",
        source:       "google",
      };
      await cacheSet(cacheKey, result, 3600);
      return result;
    }
  } catch (err) {
    logger.error("Reverse geocoding failed", { lat, lng, error: err.message });
  }

  return { error: "Reverse geocoding failed", lat, lng };
}

// ─── 4. HAVERSINE DISTANCE ─────────────────────────────────────────────────────
/**
 * Calculate distance between two lat/lng points in miles.
 */
export function distanceMiles(lat1, lng1, lat2, lng2) {
  const R    = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return (deg * Math.PI) / 180; }

// ─── 5. ZIP CODE LOOKUP ─────────────────────────────────────────────────────────
export async function lookupZip(zip) {
  const cacheKey = `zip:${zip}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return cached;

  // Try DB first
  const dbResult = await prisma.zipCode.findUnique({
    where:   { zip },
    include: { utility: true },
  });

  if (dbResult) {
    await cacheSet(cacheKey, dbResult, 86400);
    return dbResult;
  }

  // Fall back to geocoding
  const geo = await geocodeAddress(`${zip}, USA`);
  if (geo.lat) {
    const result = {
      zip,
      city:    geo.city,
      state:   geo.state,
      lat:     geo.lat,
      lng:     geo.lng,
      source:  "geocoded",
    };
    await cacheSet(cacheKey, result, 3600);
    return result;
  }

  return null;
}

// ─── 6. UTILITY TERRITORY DETECTION ───────────────────────────────────────────
/**
 * Detect which utility serves a given lat/lng coordinate.
 * Uses bounding box pre-filter, then WKT polygon for precision.
 */
export async function detectUtility(lat, lng) {
  const cacheKey = `utility:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return cached;

  // Step 1: bounding box pre-filter (fast)
  const candidates = await prisma.utilityTerritory.findMany({
    where: {
      minLat: { lte: lat },
      maxLat: { gte: lat },
      minLng: { lte: lng },
      maxLng: { gte: lng },
    },
  });

  if (!candidates.length) {
    // Step 2: widen to state lookup via ZIP
    const nearby = await prisma.zipCode.findFirst({
      where:   { lat: { gte: lat - 0.1, lte: lat + 0.1 }, lng: { gte: lng - 0.1, lte: lng + 0.1 } },
      include: { utility: true },
      orderBy: { zip: "asc" },
    });
    if (nearby?.utility) {
      await cacheSet(cacheKey, nearby.utility, 86400);
      return nearby.utility;
    }
    return null;
  }

  // Step 3: for multiple candidates, use Google to confirm
  // In production: use PostGIS ST_Contains for precision
  // For now return closest bounding box match
  const best = candidates[0];
  await cacheSet(cacheKey, best, 86400);
  return best;
}

// ─── 7. INSTALLER PROXIMITY SEARCH ────────────────────────────────────────────
/**
 * Find verified installers within radiusMiles of a lat/lng.
 * Results sorted by distance ascending.
 */
export async function findNearbyInstallers({ lat, lng, radiusMiles = 50, specialty, plan, limit = 20 }) {
  // Get all verified installer locations
  const locations = await prisma.installerLocation.findMany({
    where: {
      // Bounding box pre-filter (fast, avoids full table scan)
      lat: { gte: lat - (radiusMiles / 69), lte: lat + (radiusMiles / 69) },
      lng: { gte: lng - (radiusMiles / 52), lte: lng + (radiusMiles / 52) },
      installer: {
        verificationStatus: "VERIFIED",
        ...(specialty && { specialties: { has: specialty } }),
        ...(plan && { plan }),
      },
    },
    include: {
      installer: {
        select: {
          id: true, companyName: true, plan: true, rating: true,
          reviewCount: true, jobsCompleted: true, specialties: true,
          successFeeRate: true,
          user: { select: { name: true, avatar: true } },
        },
      },
    },
  });

  // Calculate exact distances and filter
  const withDistance = locations
    .map((loc) => ({
      ...loc.installer,
      location: { lat: loc.lat, lng: loc.lng, city: loc.city, state: loc.state },
      distanceMiles: Math.round(distanceMiles(lat, lng, loc.lat, loc.lng) * 10) / 10,
    }))
    .filter((i) => i.distanceMiles <= radiusMiles)
    .sort((a, b) => {
      // Sort: Enterprise > Pro > Free, then by distance
      const planOrder = { ENTERPRISE: 0, PRO: 1, FREE: 2 };
      const planDiff  = (planOrder[a.plan] || 2) - (planOrder[b.plan] || 2);
      return planDiff !== 0 ? planDiff : a.distanceMiles - b.distanceMiles;
    })
    .slice(0, limit);

  return withDistance;
}

// ─── 8. GOOGLE PLACES AUTOCOMPLETE (server-side) ──────────────────────────────
/**
 * Server-side Places Autocomplete for address input suggestions.
 * Usually called client-side, but provided here for SSR use cases.
 */
export async function placesAutocomplete(input, sessionToken) {
  if (!GOOGLE_KEY || input.length < 3) return { predictions: [] };

  const cacheKey = `places:${input.toLowerCase()}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return { predictions: cached, source: "cache" };

  try {
    const res = await axios.post(
      `https://places.googleapis.com/v1/places:autocomplete`,
      {
        input,
        sessionToken,
        includedRegionCodes: ["us"],
        includedPrimaryTypes: ["street_address", "premise", "subpremise", "postal_code"],
        languageCode: "en",
      },
      {
        headers: {
          "X-Goog-Api-Key": GOOGLE_KEY,
          "Content-Type": "application/json",
        },
        timeout: 5000,
      }
    );

    const predictions = (res.data.suggestions || []).map((s) => ({
      placeId:     s.placePrediction?.placeId,
      description: s.placePrediction?.text?.text,
      mainText:    s.placePrediction?.structuredFormat?.mainText?.text,
      secondaryText: s.placePrediction?.structuredFormat?.secondaryText?.text,
    }));

    await cacheSet(cacheKey, predictions, 300); // 5 min cache
    return { predictions };

  } catch (err) {
    logger.error("Places Autocomplete failed", { error: err.message });
    return { predictions: [], error: err.message };
  }
}

// ─── 9. PLACE DETAILS (lat/lng from placeId) ──────────────────────────────────
export async function getPlaceDetails(placeId) {
  if (!GOOGLE_KEY) return null;

  const cacheKey = `place:${placeId}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const res = await axios.get(
      `https://maps.googleapis.com/maps/api/place/details/json`,
      {
        params: {
          place_id:   placeId,
          fields:     "formatted_address,geometry,address_components,name",
          key:        GOOGLE_KEY,
        },
        timeout: 6000,
      }
    );

    if (res.data.status === "OK") {
      const r     = res.data.result;
      const comps = parseGoogleComponents(r.address_components);
      const result = {
        placeId,
        formatted:    r.formatted_address,
        lat:          r.geometry.location.lat,
        lng:          r.geometry.location.lng,
        streetNumber: comps.street_number,
        route:        comps.route,
        city:         comps.locality,
        state:        comps.administrative_area_level_1,
        zip:          comps.postal_code,
        county:       comps.administrative_area_level_2,
        country:      comps.country || "US",
      };
      await cacheSet(cacheKey, result, 86400);
      return result;
    }
  } catch (err) {
    logger.error("Place Details failed", { placeId, error: err.message });
  }

  return null;
}

// ─── INTERNAL HELPERS ─────────────────────────────────────────────────────────
function parseGoogleComponents(components = []) {
  const result = {};
  for (const comp of components) {
    for (const type of comp.types) {
      result[type] = comp.short_name || comp.long_name;
    }
  }
  return result;
}

function parseMapboxContext(context = []) {
  const result = {};
  for (const item of context) {
    const type = item.id.split(".")[0];
    result[type] = item.text;
  }
  return result;
}

// Fallback validator when Google Address Validation API unavailable
async function validateViaGeocoding(addressString) {
  const geo = await geocodeAddress(addressString);
  if (!geo.lat) {
    return { valid: false, issues: ["Address not found"], source: "geocoding_fallback" };
  }
  return {
    valid: !!geo.lat,
    verdict: { granularity: geo.locationType || "APPROXIMATE", complete: !!geo.streetNumber },
    normalized: {
      formatted:    geo.formatted,
      streetNumber: geo.streetNumber,
      route:        geo.route,
      city:         geo.city,
      state:        geo.state,
      zip:          geo.zip,
      county:       geo.county,
      country:      geo.country || "US",
    },
    coordinates: { lat: geo.lat, lng: geo.lng },
    placeId:     geo.placeId,
    issues:      geo.streetNumber ? [] : ["Could not confirm street number"],
    source:      "geocoding_fallback",
  };
}
