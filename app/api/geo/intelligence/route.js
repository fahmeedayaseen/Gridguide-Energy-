/**
 * GET /api/geo/intelligence
 *
 * Full geo intelligence pipeline — one call returns everything:
 *   Utility + ISO/RTO + State incentives + VPP programs + Nearby installers
 *
 * Used by:
 *   - Signup form (show opportunity preview as user types address)
 *   - Dashboard onboarding (personalized recommendations)
 *   - Installer portal (verify if customer is in territory)
 *   - Seller portal (qualify leads by location)
 *   - Admin portal (territory assignment, program eligibility)
 *
 * Query params:
 *   ?address=123+Main+St,Austin,TX  — full address string
 *   ?zip=78701                       — ZIP code only
 *   ?lat=30.27&lng=-97.74            — coordinates
 *   ?systemKw=8                      — solar system size for incentive estimate (optional)
 */

import { ok, err } from "@/lib/auth.js";
import { rateLimit } from "@/lib/redis.js";
import { getGeoIntelligence } from "@/lib/geo-intelligence.js";

export async function GET(request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const { allowed } = await rateLimit(`geo-intel:${ip}`, 60, 60); // 60/min
  if (!allowed) return err("Too many requests", 429);

  const { searchParams } = new URL(request.url);
  const address   = searchParams.get("address") || "";
  const zip       = searchParams.get("zip") || "";
  const lat       = parseFloat(searchParams.get("lat") || "0");
  const lng       = parseFloat(searchParams.get("lng") || "0");
  const systemKw  = parseFloat(searchParams.get("systemKw") || "8");

  if (!address && !zip && (!lat || !lng)) {
    return err("Provide address, zip, or lat/lng coordinates", 400);
  }

  const profile = await getGeoIntelligence({
    address: address || undefined,
    zip:     zip     || undefined,
    lat:     lat     || undefined,
    lng:     lng     || undefined,
    systemSizeKw: systemKw,
  });

  if (profile.error) return err(profile.error, 400);

  return ok(profile);
}
