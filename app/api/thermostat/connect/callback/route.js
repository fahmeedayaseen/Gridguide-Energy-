/**
 * GET /api/thermostat/connect/callback?code=...&state=...
 *
 * OAuth2 callback for Ecobee and Google Nest thermostat connections.
 * GET /api/thermostat/connect issues the authorization URL with this as its
 * redirect_uri and stores `state` in Redis; this route is what the OAuth
 * provider actually redirects the user's browser back to. Without it, the
 * same class of gap as the utility OAuth flow — the user approves access
 * and then hits a 404 on the way back, and the connection never completes.
 *
 * Honeywell and Sensi are intentionally not handled here: Honeywell's token
 * exchange isn't implemented anywhere in this codebase yet (see the
 * fallback branch in POST /api/thermostat/connect), and Sensi/Derapi use
 * credential/API-key auth, not OAuth, so they never reach this route.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db.js";
import { redis } from "@/lib/redis.js";
import { logger } from "@/lib/sentry.js";
import axios from "axios";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code       = searchParams.get("code");
  const state      = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const redirect   = `${APP_URL}/api/thermostat/connect/callback`;

  if (oauthError) {
    return NextResponse.redirect(`${APP_URL}/platform?thermostat=denied`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${APP_URL}/platform?thermostat=error&reason=missing_params`);
  }

  const userId = await redis.get(`thermo-oauth:${state}`);
  if (!userId) {
    return NextResponse.redirect(`${APP_URL}/platform?thermostat=error&reason=expired`);
  }
  await redis.del(`thermo-oauth:${state}`);

  // Brand isn't encoded in `state` today (GET /api/thermostat/connect only
  // stores the userId) — infer it from which provider's redirect actually
  // reached us isn't possible from the callback alone, so this tries Ecobee
  // first (the more common integration) and falls back to Nest. If you add
  // a third OAuth-based brand, encode brand into `state` at issuance time
  // (`${userId}:${brand}:${Date.now()}`) instead of guessing here.
  let brand, accessToken, refreshToken, externalId;

  try {
    try {
      const res = await axios.post("https://api.ecobee.com/token", null, {
        params: { grant_type: "authorization_code", code, redirect_uri: redirect, client_id: process.env.ECOBEE_CLIENT_ID },
      });
      accessToken = res.data.access_token;
      refreshToken = res.data.refresh_token;
      const devRes = await axios.get('https://api.ecobee.com/1/thermostat?format=json&body={"selection":{"selectionType":"registered"}}', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      externalId = devRes.data.thermostatList?.[0]?.identifier;
      brand = "ecobee";
    } catch {
      const res = await axios.post("https://oauth2.googleapis.com/token", {
        code, client_id: process.env.GOOGLE_SDM_CLIENT_ID,
        client_secret: process.env.GOOGLE_SDM_SECRET, redirect_uri: redirect, grant_type: "authorization_code",
      });
      accessToken = res.data.access_token;
      refreshToken = res.data.refresh_token;
      const devRes = await axios.get(
        `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_SDM_PROJECT_ID}/devices`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      externalId = devRes.data.devices?.[0]?.name?.split("/").pop();
      brand = "nest";
    }

    if (!externalId) throw new Error("Could not retrieve thermostat device ID");

    await prisma.thermostat.upsert({
      where:  { userId },
      create: { userId, brand, externalId, accessToken, refreshToken },
      update: { brand, externalId, accessToken, refreshToken, lastSyncAt: new Date() },
    });

    logger.info(`Thermostat connected via OAuth`, { userId, brand });
    return NextResponse.redirect(`${APP_URL}/platform?thermostat=success&brand=${brand}`);

  } catch (e) {
    const message = e.response?.data?.error_description || e.response?.data?.error || e.message;
    logger.error("Thermostat OAuth callback failed", { error: message, userId });
    return NextResponse.redirect(`${APP_URL}/platform?thermostat=error&reason=${encodeURIComponent(message)}`);
  }
}
