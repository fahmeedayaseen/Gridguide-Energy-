/**
 * GET /api/integrations/callback?code=...&state=...
 *
 * Universal OAuth2 callback for all brand integrations.
 * Called by: Google Nest, Ecobee, Honeywell, SmartThings, Amazon Alexa.
 * Exchanges code → tokens, discovers devices, saves to DB.
 */
import { NextResponse } from "next/server";
import { getIntegration } from "@/lib/integrations.js";
import { redis } from "@/lib/redis.js";
import { prisma } from "@/lib/db.js";
import { logger } from "@/lib/sentry.js";
import { awardDeviceConnectCredits } from "@/lib/credits.js";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  // User denied access
  if (oauthError) {
    return NextResponse.redirect(`${APP_URL}/ai-dashboard?integration=denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${APP_URL}/ai-dashboard?integration=error&reason=missing_params`);
  }

  // Retrieve + delete state from Redis. Not redis.getdel() — that method
  // doesn't exist on either Redis implementation this codebase uses (the
  // real node-redis v4 client exposes it as getDel/camelCase, and the
  // in-memory MemoryRedis fallback in lib/redis.js doesn't implement it at
  // all) — this would have thrown on every single OAuth callback.
  const stateRaw = await redis.get(`oauth-state:${state}`);
  if (!stateRaw) {
    return NextResponse.redirect(`${APP_URL}/ai-dashboard?integration=error&reason=expired`);
  }
  await redis.del(`oauth-state:${state}`);

  const { userId, brand } = JSON.parse(stateRaw);
  const integration = getIntegration(brand);
  if (!integration) {
    return NextResponse.redirect(`${APP_URL}/ai-dashboard?integration=error&reason=unknown_brand`);
  }

  try {
    // Exchange authorization code for access + refresh tokens
    const tokens = await integration.exchangeCode(code);

    // Discover devices under this account
    let devices = [];
    try {
      devices = await integration.getDevices(tokens.accessToken);
    } catch (devErr) {
      logger.warn(`Device discovery failed for ${brand}`, { error: devErr.message });
      // Still save connection even if device discovery fails
      devices = [{ id: `${brand}-${userId}`, name: `${integration.name} Account`, type: "thermostat" }];
    }

    // Save each device to the database
    let saved = 0;
    for (const device of devices) {
      const savedDevice = await prisma.device.upsert({
        where:  { externalId_userId: { externalId: String(device.id), userId } },
        update: {
          brand,
          type:         device.type || "thermostat",
          name:         device.name,
          accessToken:  tokens.accessToken,
          refreshToken: tokens.refreshToken || null,
          capabilities: device.capabilities || [],
          lastSyncAt:   new Date(),
        },
        create: {
          userId,
          brand,
          type:         device.type || "thermostat",
          externalId:   String(device.id),
          name:         device.name,
          accessToken:  tokens.accessToken,
          refreshToken: tokens.refreshToken || null,
          capabilities: device.capabilities || [],
        },
      });
      saved++;

      // One-time 250-credit bonus per device. Keyed to Device.id (DB primary key)
      // so reconnects via upsert reuse the same key — blocked by RewardGrant
      // unique constraint. Safe to fire and forget; never blocks the redirect.
      awardDeviceConnectCredits(userId, savedDevice.id, savedDevice.name || brand)
        .catch(e => logger.warn("[OAuth] Device credit award failed", { error: e.message, deviceId: savedDevice.id }));
    }

    logger.info(`Integration connected: ${brand} — ${saved} devices for user ${userId}`);
    return NextResponse.redirect(
      `${APP_URL}/ai-dashboard?integration=success&brand=${brand}&devices=${saved}`
    );

  } catch (e) {
    logger.error(`OAuth callback failed for ${brand}`, { error: e.message, userId });
    return NextResponse.redirect(
      `${APP_URL}/ai-dashboard?integration=error&brand=${brand}&reason=${encodeURIComponent(e.message)}`
    );
  }
}
