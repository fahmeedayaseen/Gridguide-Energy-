import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { cacheGet, cacheSet } from "@/lib/redis.js";
import axios from "axios";

// GET /api/utility/rates?zip=94105&utility=pge — fetch current TOU rates
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const zip     = searchParams.get("zip") || "";
  const utility = searchParams.get("utility") || "";

  const cacheKey = `rates:${zip}:${utility}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return ok({ rates: cached, source: "cache" });

  try {
    // UtilityAPI for rate data
    const res = await axios.get("https://utilityapi.com/api/v2/rates", {
      headers: { Authorization: `Bearer ${process.env.UTILITYAPI_KEY}` },
      params:  { zip, utility },
      timeout: 8000,
    });

    const rates = res.data;
    await cacheSet(cacheKey, rates, 1800); // 30 min cache
    return ok({ rates, source: "live" });

  } catch (apiErr) {
    // Live data unavailable — report that clearly. A generic TOU rate
    // guess with specific-looking dollar figures ($0.38/$0.12) would look
    // like this user's real rate plan when it isn't.
    return err("Live rate data is temporarily unavailable. Please try again shortly.", 503, { source: "unavailable" });
  }
}
