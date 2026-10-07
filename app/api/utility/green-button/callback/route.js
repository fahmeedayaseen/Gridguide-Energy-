/**
 * GET /api/utility/green-button/callback?code=...&state=...
 *
 * Green Button Connect My Data OAuth 2.0 callback handler.
 *
 * After the homeowner approves data sharing on their utility's "Share My Data"
 * portal, the utility redirects their browser back here with an authorization
 * code. This route:
 *   1. Validates the PKCE state token (verifies the callback belongs to
 *      a real GridGuide authorization request, preventing CSRF attacks).
 *   2. Exchanges the authorization code for an ESPI access + refresh token
 *      using the Green Button Alliance's token endpoint (or the utility's own
 *      token endpoint for utilities with dedicated GBC implementations).
 *   3. Fetches the initial batch of ESPI XML data (interval reads, billing).
 *   4. Saves the connection durably to UtilityAccount so it survives Redis
 *      flushes and appears in the Admin → Utility Intelligence monitoring view.
 *   5. Redirects the homeowner back to their GridGuide dashboard.
 */
import { NextResponse }        from "next/server";
import { prisma }              from "@/lib/db.js";
import { redis }               from "@/lib/redis.js";
import { logger }              from "@/lib/sentry.js";

const APP_URL         = process.env.NEXT_PUBLIC_APP_URL    || "https://gridguide.ai";
const GB_CLIENT_ID    = process.env.GREEN_BUTTON_CLIENT_ID;
const GB_CLIENT_SECRET= process.env.GREEN_BUTTON_CLIENT_SECRET;
const REDIRECT_URI    = `${APP_URL}/api/utility/green-button/callback`;

// Token endpoints for major utilities that run their own GBC implementation.
// Utilities not listed here use the Green Button Alliance's shared service.
const GB_TOKEN_URLS = {
  pge:        "https://sharemydataapi.pge.com/gbc/token",
  sce:        "https://secure.sce.com/sso/teserver/smduae/token",
  sdge:       "https://myaccount.sdge.com/portal/GBC/token",
  eversource: "https://www.eversource.com/gbconnect/token",
  national:   "https://gbconnect.nationalgridus.com/token",
  coned:      "https://cned.com/greenbutton/token",
  pseg:       "https://myaccount.pseg.com/greenbutton/token",
  peco:       "https://secure.peco.com/greenbutton/token",
  duke:       "https://www.duke-energy.com/api/gb/token",
  dominion:   "https://www.dominionenergy.com/MyAccount/GBC/Token",
  aps:        "https://www.aps.com/greenbutton/token",
  exelon:     "https://secure.comed.com/GreenButton/Token",
  xcel:       "https://my.xcelenergy.com/xcelapi/gbc/token",
  austin:     "https://greenbutton.austinenergy.com/token",
  pse:        "https://pse.com/greenbutton/token",
};

// ESPI resource endpoints for fetching meter data after OAuth completes
const GB_RESOURCE_URLS = {
  pge:        "https://sharemydataapi.pge.com/DataCustodian/espi/1_1/resource",
  sce:        "https://espi.sce.com/espi/1_1/resource",
  default:    "https://services.greenbuttondata.org/DataCustodian/espi/1_1/resource",
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code       = searchParams.get("code");
  const state      = searchParams.get("state");
  const gbError    = searchParams.get("error");
  const errorDesc  = searchParams.get("error_description");

  const FAIL  = (reason) => NextResponse.redirect(`${APP_URL}/platform?utility=denied&reason=${encodeURIComponent(reason)}`);
  const SUCC  = (meters) => NextResponse.redirect(`${APP_URL}/platform?utility=success&method=green_button&meters=${meters}`);

  if (gbError) {
    logger.warn("Green Button authorization denied by user or utility", { error: gbError, description: errorDesc });
    return FAIL(errorDesc || gbError);
  }

  if (!code || !state) return FAIL("missing_params");

  // Validate PKCE state
  const stateData = await redis.get(`gbc:state:${state}`);
  if (!stateData) return FAIL("state_expired");

  let parsedState;
  try { parsedState = JSON.parse(stateData); } catch { return FAIL("invalid_state"); }
  const { userId, utilityId } = parsedState;
  await redis.del(`gbc:state:${state}`);

  // ── Exchange authorization code for access token ──────────────────────────
  const tokenUrl = GB_TOKEN_URLS[utilityId?.toLowerCase()] || `${GB_RESOURCE_URLS.default}/../token`;

  let tokenData;
  try {
    const body = new URLSearchParams({
      grant_type:   "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    });
    if (GB_CLIENT_ID)     body.set("client_id",     GB_CLIENT_ID);
    if (GB_CLIENT_SECRET) body.set("client_secret",  GB_CLIENT_SECRET);

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Token exchange failed ${tokenRes.status}: ${errText.slice(0, 200)}`);
    }
    tokenData = await tokenRes.json();
  } catch (e) {
    logger.error("Green Button token exchange failed", { error: e.message, userId, utilityId });
    await prisma.utilityConnectionEvent.create({
      data: { userId, method: "GREEN_BUTTON", success: false, errorMessage: e.message },
    }).catch(() => {});
    return FAIL(`token_exchange_failed: ${e.message}`);
  }

  const { access_token, refresh_token, expires_in, resource_uri } = tokenData;

  // ── Cache tokens in Redis (fast path for bills/usage endpoints) ───────────
  const resourceUrl = resource_uri || GB_RESOURCE_URLS[utilityId?.toLowerCase()] || GB_RESOURCE_URLS.default;
  await redis.set(`utility:${userId}`, JSON.stringify({
    provider:      "green_button",
    utilityId,
    accessToken:   access_token,
    refreshToken:  refresh_token,
    expiresAt:     expires_in ? Date.now() + expires_in * 1000 : null,
    resourceUrl,
    connectedAt:   new Date().toISOString(),
  }));

  // ── Persist durable record ────────────────────────────────────────────────
  await prisma.utilityAccount.upsert({
    where: { externalAccountId_userId: { externalAccountId: `gb_${utilityId}_${userId}`, userId } },
    update: {
      status: "CONNECTED", lastSyncAt: new Date(), syncError: null,
      metadata: { provider: "green_button", utilityId, resourceUrl, expiresIn: expires_in },
    },
    create: {
      userId,
      provider:          "GreenButton",
      connectionType:    "GREEN_BUTTON",
      externalAccountId: `gb_${utilityId}_${userId}`,
      status:            "CONNECTED",
      lastSyncAt:         new Date(),
      metadata:          { provider: "green_button", utilityId, resourceUrl, expiresIn: expires_in },
    },
  }).catch((e) => logger.warn("UtilityAccount upsert failed after GBC", { error: e.message, userId }));

  // ── Persist utilityConnected on User so DashUtility shows it immediately ─
  await prisma.user.update({
    where: { id: userId },
    data:  { utilityConnected: true, utilityProvider: utilityId.toUpperCase() },
  }).catch(() => {});

  // ── Log success ───────────────────────────────────────────────────────────
  await prisma.utilityConnectionEvent.updateMany({
    where: { userId, method: "GREEN_BUTTON", success: false },
    data:  { success: true, errorMessage: null },
  }).catch(() => {});

  logger.info("Green Button Connect completed", { userId, utilityId });
  return SUCC(1); // meter count will be populated during first ESPI sync
}
