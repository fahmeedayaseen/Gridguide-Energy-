import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { redis, cacheGet, cacheSet } from "@/lib/redis.js";
import axios from "axios";

const UA_KEY  = process.env.UTILITYAPI_KEY;
const UA_BASE = "https://utilityapi.com/api/v2";

// GET /api/utility/bills — last 12 months of utility bills
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const raw = await redis.get(`utility:${auth.user.id}`);
  if (!raw) return err("No utility account connected.", 404);

  const conn = JSON.parse(raw);

  const cacheKey = `bills:${auth.user.id}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return ok({ ...cached, source: "cache" });

  try {
    const res = await axios.get(`${UA_BASE}/bills`, {
      headers: { Authorization: `Bearer ${UA_KEY}` },
      params:  { uid: conn.uid, limit: 24 },
    });

    const bills = res.data.bills || [];

    // Calculate year-over-year savings trend
    const thisYear = bills.filter(b => new Date(b.bill_start_date).getFullYear() === new Date().getFullYear());
    const lastYear = bills.filter(b => new Date(b.bill_start_date).getFullYear() === new Date().getFullYear() - 1);

    const thisYearTotal = thisYear.reduce((s, b) => s + (b.bill_total_cost || 0), 0);
    const lastYearTotal = lastYear.reduce((s, b) => s + (b.bill_total_cost || 0), 0);
    const yoySavings    = lastYearTotal - thisYearTotal;
    const yoyPct        = lastYearTotal ? (yoySavings / lastYearTotal * 100) : 0;

    const result = {
      bills,
      summary: {
        count:          bills.length,
        thisYearTotal:  Math.round(thisYearTotal * 100) / 100,
        lastYearTotal:  Math.round(lastYearTotal * 100) / 100,
        yoySavings:     Math.round(yoySavings * 100) / 100,
        yoyPct:         Math.round(yoyPct * 10) / 10,
      },
    };

    await cacheSet(cacheKey, result, 86400); // cache 24h
    return ok({ ...result, source: "live" });

  } catch {
    // Live data unavailable — report that clearly rather than returning
    // fabricated numbers. A user with a real (but temporarily failing)
    // connection should never see randomly-generated bills that look real.
    return err("Live bill data is temporarily unavailable. Please try again shortly.", 503, { source: "unavailable" });
  }
}
