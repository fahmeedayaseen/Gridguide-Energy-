import { ok, err } from "@/lib/auth.js";
import { placesAutocomplete, getPlaceDetails } from "@/lib/geo.js";
import { rateLimit } from "@/lib/redis.js";

/**
 * GET /api/geo/search?q=123+Main+St&session=abc123
 *
 * Returns Google Places Autocomplete suggestions as the user types.
 * Powers the address input fields across all GridGuide signup forms.
 *
 * session: Use a UUID per address input session to group requests
 *          for billing purposes (Google charges per session, not per keystroke).
 *
 * GET /api/geo/search?placeId=ChIJ...
 * Resolves a placeId to full address details + lat/lng.
 */
export async function GET(request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const { allowed } = await rateLimit(`places-autocomplete:${ip}`, 120, 60); // 120/min
  if (!allowed) return err("Too many requests", 429);

  const { searchParams } = new URL(request.url);
  const query        = searchParams.get("q") || "";
  const placeId      = searchParams.get("placeId") || "";
  const sessionToken = searchParams.get("session") || "";

  // Resolve a specific placeId to full address
  if (placeId) {
    const details = await getPlaceDetails(placeId);
    if (!details) return err("Place not found", 404);
    return ok({ place: details });
  }

  // Autocomplete suggestions
  if (query.length < 3) {
    return ok({ predictions: [] });
  }

  const result = await placesAutocomplete(query, sessionToken);
  return ok(result);
}
