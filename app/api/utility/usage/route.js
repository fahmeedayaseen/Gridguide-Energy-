import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { redis, cacheGet, cacheSet } from "@/lib/redis.js";
import axios from "axios";

const UA_KEY  = process.env.UTILITYAPI_KEY;
const UA_BASE = "https://utilityapi.com/api/v2";

// GET /api/utility/usage?period=30d — kWh usage history
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "30d";

  // Get utility connection
  const raw = await redis.get(`utility:${auth.user.id}`);
  if (!raw) return err("No utility account connected. Connect your utility first.", 404);

  const conn = JSON.parse(raw);
  if (!conn.meters?.length) return err("No meters found on your utility account.", 404);

  const cacheKey = `usage:${auth.user.id}:${period}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return ok({ ...cached, source: "cache" });

  // Date range
  const now   = new Date();
  const days  = parseInt(period) || 30;
  const start = new Date(now - days * 86400000).toISOString().split("T")[0];
  const end   = now.toISOString().split("T")[0];

  try {
    const res = await axios.get(`${UA_BASE}/intervals`, {
      headers: { Authorization: `Bearer ${UA_KEY}` },
      params:  { uid: conn.uid, start, end, granularity: "day" },
    });

    const intervals = res.data.intervals || [];

    // Compute summary stats
    const totalKwh    = intervals.reduce((s, i) => s + (i.kwh || 0), 0);
    const avgDailyKwh = intervals.length ? totalKwh / intervals.length : 0;
    const peakDay     = intervals.reduce((m, i) => (i.kwh > (m?.kwh || 0) ? i : m), null);

    const result = {
      intervals,
      summary: {
        totalKwh:    Math.round(totalKwh * 100) / 100,
        avgDailyKwh: Math.round(avgDailyKwh * 100) / 100,
        peakDay:     peakDay?.date,
        peakKwh:     peakDay?.kwh,
        period,
        start,
        end,
      },
    };

    await cacheSet(cacheKey, result, 3600); // 1 hour cache
    return ok({ ...result, source: "live" });

  } catch (apiErr) {
    // Live data unavailable — report that clearly rather than returning
    // fabricated daily usage numbers.
    return err("Live usage data is temporarily unavailable. Please try again shortly.", 503, { source: "unavailable" });
  }
}
