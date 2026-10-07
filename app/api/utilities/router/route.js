/**
 * GET /api/utilities/router
 *
 * Utility Intelligence Module — Phase 5: AI Utility Router.
 *
 * Given a homeowner's location (zip, lat/lng, or address), this returns:
 *   - which utility serves them
 *   - the recommended connection method, with a plain-language reason
 *     (Green Button -> Arcadia -> direct API -> manual bill upload, per
 *     lib/utility-routing.js)
 *   - available VPP / demand-response programs
 *   - available rebates & incentives (federal, state, utility) with an
 *     estimated total dollar value
 *   - net metering and time-of-use rate availability
 *   - an estimated annual VPP earnings range
 *
 * This is a thin, purpose-built wrapper around the same
 * lib/geo-intelligence.js pipeline that already powers
 * /api/geo/utility-territory and /api/geo/intelligence — it doesn't
 * duplicate that logic, just presents it under the name and shape this
 * specific capability is meant to have.
 *
 * Public + rate-limited, same as the other address-lookup endpoints.
 * ?zip=78701 | ?lat=30.27&lng=-97.74 | ?address=Austin,TX | &systemSizeKw=8
 */
import { ok, err } from "@/lib/auth.js";
import { rateLimit } from "@/lib/redis.js";
import { getGeoIntelligence } from "@/lib/geo-intelligence.js";

export async function GET(request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const { allowed } = await rateLimit(`utility-router:${ip}`, 120, 60);
  if (!allowed) return err("Too many requests", 429);

  const { searchParams } = new URL(request.url);
  const zip     = searchParams.get("zip") || "";
  const lat     = parseFloat(searchParams.get("lat") || "0");
  const lng     = parseFloat(searchParams.get("lng") || "0");
  const address = searchParams.get("address") || "";
  const systemSizeKw = parseFloat(searchParams.get("systemSizeKw") || "8");

  if (!zip && (!lat || !lng) && !address) {
    return err("Provide zip, lat/lng, or address", 400);
  }

  const profile = await getGeoIntelligence({
    zip: zip || undefined, lat: lat || undefined, lng: lng || undefined,
    address: address || undefined, systemSizeKw,
  });

  if (profile.error) return err(profile.error, 400);

  if (!profile.utility) {
    return ok({
      found: false,
      location: profile.location,
      connection: { method: "BILL_UPLOAD", label: "Secure Login / Bill Upload", reason: "We couldn't identify a utility for this address yet — upload a recent bill and we'll extract your usage and rate plan.", fallbacks: [] },
      message: "No utility on file for this location yet. You can still connect by uploading a bill, and our team can add your utility to the database.",
    });
  }

  return ok({
    found: true,
    location: profile.location,
    utility: {
      name: profile.utility.name,
      shortName: profile.utility.shortName,
      website: profile.utility.website,
      customerPortalUrl: profile.utility.customerPortalUrl,
      phone: profile.utility.phone,
      dataSource: profile.utility.dataSource, // "database" | "hardcoded_fallback" — surfaced so admins can see coverage gaps
    },
    connection: profile.utility.connection,
    eligibility: {
      vpp: profile.utility.vppReady,
      netMetering: profile.utility.netMetering,
      touRates: profile.utility.touRates,
      demandResponse: profile.utility.drEnabled,
    },
    programs: {
      vppAndDemandResponse: profile.vpp.programs,
      utilityPrograms: profile.utility.programs,
      ratePlans: profile.utility.ratePlans,
    },
    incentives: profile.incentives,
    estimatedSavings: {
      incentivesTotal: profile.incentives.estimatedValue,
      vppAnnualEarnings: profile.vpp.estimatedAnnualEarnings,
    },
    grid: profile.iso,
    summary: profile.summary,
  });
}
