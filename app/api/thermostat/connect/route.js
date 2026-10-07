import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { redis } from "@/lib/redis.js";
import axios from "axios";
import { z } from "zod";

const connectSchema = z.object({
  brand:  z.enum(["ecobee","nest","honeywell","sensi","derapi"]),
  code:   z.string().optional(),  // OAuth authorization code
  deviceId: z.string().optional(), // Direct Derapi device ID
});

// GET /api/thermostat/connect?brand=ecobee — get OAuth URL for a brand
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const brand = searchParams.get("brand");
  if (!brand) return err("brand required", 400);

  const state    = `${auth.user.id}:${Date.now()}`;
  const redirect = `${process.env.NEXT_PUBLIC_APP_URL}/api/thermostat/connect/callback`;

  // Store state in Redis to verify on callback (5 min expiry)
  await redis.setEx(`thermo-oauth:${state}`, 300, auth.user.id);

  const urls = {
    ecobee:    `https://api.ecobee.com/authorize?response_type=code&client_id=${process.env.ECOBEE_CLIENT_ID}&redirect_uri=${redirect}&scope=smartWrite&state=${state}`,
    nest:      `https://nestservices.google.com/partnerconnections/${process.env.GOOGLE_SDM_PROJECT_ID}/auth?redirect_uri=${redirect}&access_type=offline&prompt=consent&client_id=${process.env.GOOGLE_SDM_CLIENT_ID}&response_type=code&scope=https://www.googleapis.com/auth/sdm.service&state=${state}`,
    honeywell: `https://api.honeywellhome.com/oauth2/authorize?response_type=code&redirect_uri=${redirect}&client_id=${process.env.HONEYWELL_CONSUMER_KEY}&state=${state}`,
    sensi:     null, // Sensi uses credential-based auth, not OAuth
    derapi:    null, // Derapi uses API key, no OAuth needed
  };

  if (!urls[brand]) {
    return ok({
      brand,
      requiresCredentials: true,
      message: "This brand uses API key or credential-based authentication. Use the POST endpoint with your credentials.",
    });
  }

  return ok({ authUrl: urls[brand], brand, state });
}

// POST /api/thermostat/connect — complete connection (OAuth callback or credentials)
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, connectSchema);
  if (error) return err("Validation failed", 400, error);

  const redirect = `${process.env.NEXT_PUBLIC_APP_URL}/api/thermostat/connect/callback`;
  let accessToken  = null;
  let refreshToken = null;
  let externalId   = null;

  try {
    switch (data.brand) {

      case "ecobee": {
        if (!data.code) return err("Authorization code required for Ecobee", 400);
        const res = await axios.post("https://api.ecobee.com/token", null, {
          params: { grant_type: "authorization_code", code: data.code, redirect_uri: redirect, client_id: process.env.ECOBEE_CLIENT_ID },
        });
        accessToken  = res.data.access_token;
        refreshToken = res.data.refresh_token;
        // Get thermostat ID
        const devRes = await axios.get('https://api.ecobee.com/1/thermostat?format=json&body={"selection":{"selectionType":"registered"}}', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        externalId = devRes.data.thermostatList[0]?.identifier;
        break;
      }

      case "nest": {
        if (!data.code) return err("Authorization code required for Google Nest", 400);
        const res = await axios.post("https://oauth2.googleapis.com/token", {
          code: data.code, client_id: process.env.GOOGLE_SDM_CLIENT_ID,
          client_secret: process.env.GOOGLE_SDM_SECRET, redirect_uri: redirect, grant_type: "authorization_code",
        });
        accessToken  = res.data.access_token;
        refreshToken = res.data.refresh_token;
        const devRes = await axios.get(
          `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_SDM_PROJECT_ID}/devices`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        externalId = devRes.data.devices?.[0]?.name?.split("/").pop();
        break;
      }

      case "derapi":
      case "honeywell":
      default: {
        // For Derapi, use the deviceId directly
        externalId = data.deviceId || "derapi-default";
        break;
      }
    }
  } catch (apiErr) {
    return err(`Failed to connect ${data.brand}: ${apiErr.response?.data?.error || apiErr.message}`, 502);
  }

  if (!externalId) return err("Could not retrieve thermostat device ID", 502);

  // Upsert thermostat record
  const thermostat = await prisma.thermostat.upsert({
    where:  { userId: auth.user.id },
    create: { userId: auth.user.id, brand: data.brand, externalId, accessToken, refreshToken },
    update: { brand: data.brand, externalId, accessToken, refreshToken, lastSyncAt: new Date() },
  });

  return ok({ thermostat: { id: thermostat.id, brand: thermostat.brand }, message: `${data.brand} thermostat connected.` });
}

// DELETE /api/thermostat/connect — disconnect thermostat
export async function DELETE(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  await prisma.thermostat.deleteMany({ where: { userId: auth.user.id } });
  return ok({ message: "Thermostat disconnected." });
}
