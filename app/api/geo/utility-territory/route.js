/**
 * GET /api/geo/utility-territory
 *
 * Identify utility + ISO/RTO + VPP programs for a location.
 * Lighter than /api/geo/intelligence — no installer search.
 *
 * ?zip=78701 | ?lat=30.27&lng=-97.74 | ?address=Austin,TX
 */
import { ok, err } from "@/lib/auth.js";
import { rateLimit } from "@/lib/redis.js";
import { getGeoIntelligence } from "@/lib/geo-intelligence.js";
import { geocodeAddress, lookupZip } from "@/lib/geo.js";

export async function GET(request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const { allowed } = await rateLimit(`util-territory:${ip}`, 120, 60);
  if (!allowed) return err("Too many requests", 429);

  const { searchParams } = new URL(request.url);
  const zip     = searchParams.get("zip") || "";
  const lat     = parseFloat(searchParams.get("lat") || "0");
  const lng     = parseFloat(searchParams.get("lng") || "0");
  const address = searchParams.get("address") || "";

  if (!zip && (!lat || !lng) && !address) {
    return err("Provide zip, lat/lng, or address", 400);
  }

  const profile = await getGeoIntelligence({
    zip:     zip     || undefined,
    lat:     lat     || undefined,
    lng:     lng     || undefined,
    address: address || undefined,
  });

  if (profile.error) return err(profile.error, 400);

  return ok({
    found:         !!profile.utility,
    location:      profile.location,
    utility:       profile.utility,
    iso:           profile.iso,
    vppEligible:   profile.vpp?.eligible,
    vppPrograms:   profile.vpp?.programs || [],
    vppEarnings:   profile.vpp?.estimatedAnnualEarnings,
    incentives: {
      count:    profile.incentives?.total,
      federal:  profile.incentives?.federal,
      state:    profile.incentives?.state,
      utility:  profile.incentives?.utility,
      estimated:profile.incentives?.estimatedValue,
    },
    summary: profile.summary,
  });
}
