import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { redis } from "@/lib/redis.js";
import axios from "axios";
import { assertLimit } from "@/lib/memberships.js";
import { getEffectivePlanForUser } from "@/lib/effective-plan.js";
import { z } from "zod";

const BASE    = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";
const UA_KEY  = process.env.UTILITYAPI_KEY;
const UA_BASE = "https://utilityapi.com/api/v2";

// GET /api/utility/connect?utility=pge — get UtilityAPI authorization URL
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const utility = searchParams.get("utility") || "";

  const user = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { plan: true } });
  const effectivePlan = await getEffectivePlanForUser(auth.user.id);
  const existingConnection = await redis.get(`utility:${auth.user.id}`);
  const connectionCount = existingConnection ? 1 : 0;
  const limitCheck = assertLimit(effectivePlan || user?.plan, "utilityConnections", connectionCount, "Utility connection");
  if (!limitCheck.allowed) return err(limitCheck.error, limitCheck.status, limitCheck);

  // Store state for callback verification
  const state = `${auth.user.id}:${Date.now()}`;
  await redis.setEx(`utility-oauth:${state}`, 600, auth.user.id);

  // UtilityAPI authorization URL
  const authUrl = `${UA_BASE}/utilities/${utility}/authorization?`
    + new URLSearchParams({
        referral_code: UA_KEY,
        scope:         "bills meters",
        response_type: "code",
        redirect_uri:  `${BASE}/api/utility/connect/callback`,
        state,
      }).toString();

  return ok({ authUrl, state });
}

// POST /api/utility/connect — save utility connection token after OAuth
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, z.object({
    code:  z.string(),
    state: z.string(),
  }));
  if (error) return err("Invalid request", 400);

  // Verify state
  const storedId = await redis.get(`utility-oauth:${data.state}`);
  if (!storedId || storedId !== auth.user.id) {
    return err("Invalid or expired authorization. Please try again.", 400);
  }
  await redis.del(`utility-oauth:${data.state}`);

  // Exchange code for UtilityAPI access token
  try {
    const res = await axios.post(`${UA_BASE}/tokens`, {
      referral_code: UA_KEY,
      code:          data.code,
      redirect_uri:  `${BASE}/api/utility/connect/callback`,
    });

    const { uid: utilityApiUid, meters } = res.data;

    // Store in Redis (not DB — UtilityAPI tokens are long-lived and managed server-side)
    await redis.set(`utility:${auth.user.id}`, JSON.stringify({
      uid:          utilityApiUid,
      meters:       meters || [],
      connectedAt:  new Date().toISOString(),
    }));

    return ok({
      connected:  true,
      meterCount: meters?.length || 0,
      message:    "Utility account connected successfully.",
    });

  } catch (apiErr) {
    return err(`UtilityAPI connection failed: ${apiErr.response?.data?.message || apiErr.message}`, 502);
  }
}

// DELETE /api/utility/connect — disconnect utility account
export async function DELETE(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  await redis.del(`utility:${auth.user.id}`);
  return ok({ message: "Utility account disconnected." });
}
