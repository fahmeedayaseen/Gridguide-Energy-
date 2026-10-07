/**
 * GET /api/utility/connect/callback?code=...&state=...
 *
 * UtilityAPI OAuth2 callback. GET /api/utility/connect issues the
 * authorization URL with this as its redirect_uri and stores `state` in
 * Redis; this route is what UtilityAPI actually redirects the user's
 * browser back to once they approve access. Without this route, the
 * authorization flow could never complete — the user would approve access
 * on UtilityAPI's site and then hit a 404 on the way back.
 *
 * Exchanges the authorization code for an access token, caches it in Redis
 * under the same `utility:{userId}` key that GET /api/utility/bills and
 * GET /api/utility/usage already read from (that pattern is unchanged),
 * and additionally persists a durable UtilityAccount + UtilityConnectionEvent
 * row so the connection survives a Redis flush/restart and shows up in the
 * Admin → Utility Intelligence connection-monitoring view.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db.js";
import { redis } from "@/lib/redis.js";
import { logger } from "@/lib/sentry.js";
import axios from "axios";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";
const UA_KEY  = process.env.UTILITYAPI_KEY;
const UA_BASE = "https://utilityapi.com/api/v2";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code        = searchParams.get("code");
  const state       = searchParams.get("state");
  const oauthError  = searchParams.get("error");

  // User denied access on UtilityAPI's authorization page
  if (oauthError) {
    return NextResponse.redirect(`${APP_URL}/platform?utility=denied`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${APP_URL}/platform?utility=error&reason=missing_params`);
  }

  // Retrieve + delete state from Redis. Not using redis.getdel() here —
  // that method doesn't exist on either Redis implementation this codebase
  // uses (the real node-redis v4 client exposes it as getDel/camelCase, and
  // the in-memory MemoryRedis fallback in lib/redis.js doesn't implement it
  // at all), so a plain get-then-del is used instead — matches what
  // POST /api/utility/connect already does for the same state check.
  const userId = await redis.get(`utility-oauth:${state}`);
  if (!userId) {
    return NextResponse.redirect(`${APP_URL}/platform?utility=error&reason=expired`);
  }
  await redis.del(`utility-oauth:${state}`);

  try {
    // Exchange authorization code for an access token
    const res = await axios.post(`${UA_BASE}/tokens`, {
      referral_code: UA_KEY,
      code,
      redirect_uri:  `${APP_URL}/api/utility/connect/callback`,
    });
    const { uid: utilityApiUid, meters } = res.data;

    // Cache for the live bills/usage endpoints (existing pattern — unchanged)
    await redis.set(`utility:${userId}`, JSON.stringify({
      uid:         utilityApiUid,
      meters:      meters || [],
      connectedAt: new Date().toISOString(),
    }));

    // Durable record. upsert (not create) because @@unique([externalAccountId, userId])
    // means a user reconnecting the same UtilityAPI account would otherwise 409.
    await prisma.utilityAccount.upsert({
      where: { externalAccountId_userId: { externalAccountId: String(utilityApiUid), userId } },
      update: { status: "CONNECTED", lastSyncAt: new Date(), syncError: null, metadata: { meterCount: meters?.length || 0 } },
      create: {
        userId,
        provider:          "UtilityAPI",
        connectionType:    "UTILITY_API",
        externalAccountId: String(utilityApiUid),
        status:            "CONNECTED",
        lastSyncAt:         new Date(),
        metadata:          { meterCount: meters?.length || 0 },
      },
    }).catch((e) => logger.warn("UtilityAccount upsert failed after successful OAuth exchange", { error: e.message, userId }));

    await prisma.utilityConnectionEvent.create({
      data: { userId, method: "UTILITY_API", success: true },
    }).catch(() => {});

    logger.info(`Utility connected via UtilityAPI OAuth`, { userId, meterCount: meters?.length || 0 });
    return NextResponse.redirect(`${APP_URL}/platform?utility=success&meters=${meters?.length || 0}`);

  } catch (e) {
    const message = e.response?.data?.message || e.message;
    await prisma.utilityConnectionEvent.create({
      data: { userId, method: "UTILITY_API", success: false, errorMessage: message },
    }).catch(() => {});
    logger.error("Utility OAuth callback failed", { error: message, userId });
    return NextResponse.redirect(`${APP_URL}/platform?utility=error&reason=${encodeURIComponent(message)}`);
  }
}
