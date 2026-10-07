import { ok, err } from "@/lib/auth.js";
import { reverseGeocode, detectUtility } from "@/lib/geo.js";
import { rateLimit } from "@/lib/redis.js";

/**
 * GET /api/geo/reverse?lat=30.27&lng=-97.74
 *
 * Convert GPS coordinates to a human-readable address.
 * Used when the user shares their device location instead of typing an address.
 */
export async function GET(request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const { allowed } = await rateLimit(`geo-reverse:${ip}`, 120, 60); // 120/min, matches geo/search
  if (!allowed) return err("Too many requests", 429);

  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get("lat") || "0");
  const lng = parseFloat(searchParams.get("lng") || "0");
  const includeUtility = searchParams.get("utility") !== "false";

  if (!lat || !lng || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return err("Valid lat and lng required", 400);
  }

  const [address, utility] = await Promise.all([
    reverseGeocode(lat, lng),
    includeUtility ? detectUtility(lat, lng) : null,
  ]);

  if (address.error) return err(address.error, 500);

  return ok({
    address,
    utility: utility ? {
      name:      utility.name,
      shortName: utility.shortName,
      state:     utility.state,
    } : null,
    coordinates: { lat, lng },
  });
}
