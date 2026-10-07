import { ok, err } from "@/lib/auth.js";
import { lookupZip, geocodeAddress, findNearbyInstallers } from "@/lib/geo.js";
import { cacheGet, cacheSet } from "@/lib/redis.js";
import { rateLimit } from "@/lib/redis.js";

/**
 * GET /api/geo/installers
 *
 * Find verified installers near a location. Accepts:
 *   ?zip=78701            — search by ZIP code
 *   ?lat=30.27&lng=-97.74 — search by coordinates
 *   ?address=Austin,+TX   — search by address string
 *   ?radius=50            — radius in miles (default 50)
 *   ?specialty=Solar+PV   — filter by specialty
 *   ?plan=ENTERPRISE           — filter by plan
 *   ?limit=20             — max results
 *
 * Returns installers sorted by: Plan tier (Enterprise > Pro > Free) then distance.
 */
export async function GET(request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const { allowed } = await rateLimit(`geo-installers:${ip}`, 120, 60); // 120/min - the cache alone doesn't stop an attacker varying params to bypass it
  if (!allowed) return err("Too many requests", 429);

  const { searchParams } = new URL(request.url);

  const zip       = searchParams.get("zip");
  const lat       = parseFloat(searchParams.get("lat") || "0");
  const lng       = parseFloat(searchParams.get("lng") || "0");
  const address   = searchParams.get("address") || "";
  const radius    = Math.min(200, parseInt(searchParams.get("radius") || "50"));
  const specialty = searchParams.get("specialty") || "";
  const plan      = searchParams.get("plan") || "";
  const limit     = Math.min(50, parseInt(searchParams.get("limit") || "20"));

  // Resolve coordinates
  let searchLat = lat;
  let searchLng = lng;
  let resolvedFrom = "coordinates";

  if (!searchLat && zip) {
    const zipData = await lookupZip(zip);
    if (!zipData) return err(`ZIP code ${zip} not found`, 404);
    searchLat    = zipData.lat;
    searchLng    = zipData.lng;
    resolvedFrom = `zip:${zip}`;
  } else if (!searchLat && address) {
    const geo    = await geocodeAddress(address);
    if (!geo.lat) return err("Could not locate address", 400);
    searchLat    = geo.lat;
    searchLng    = geo.lng;
    resolvedFrom = `address:${geo.formatted}`;
  }

  if (!searchLat || !searchLng) {
    return err("Provide zip, lat/lng, or address to search", 400);
  }

  const cacheKey = `geo-installers:${searchLat.toFixed(3)},${searchLng.toFixed(3)}:${radius}:${specialty}:${plan}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return ok({ ...cached, source: "cache" });

  const installers = await findNearbyInstallers({
    lat:       searchLat,
    lng:       searchLng,
    radiusMiles: radius,
    specialty,
    plan,
    limit,
  });

  const result = {
    installers,
    total:       installers.length,
    searchCenter: { lat: searchLat, lng: searchLng },
    radiusMiles:  radius,
    resolvedFrom,
  };

  await cacheSet(cacheKey, result, 300); // 5 min cache
  return ok({ ...result, source: "live" });
}
