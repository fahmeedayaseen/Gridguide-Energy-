/**
 * GET /api/utility/green-button/authorize?utilityId=pge
 *
 * Initiates a Green Button Connect My Data (GBC) OAuth 2.0 authorization.
 * GBC is the U.S. Department of Energy's national standard (ESPI — Energy
 * Service Provider Interface) for homeowners to securely share their utility
 * meter data with third parties. GridGuide is enrolled in the Green Button
 * Alliance developer program.
 *
 * Flow:
 *   1. GridGuide redirects the homeowner to their utility's "Share My Data"
 *      OAuth 2.0 authorization endpoint (greenButtonAuthUrl in the DB, or
 *      the utility-specific URL from the hardcoded map below for major utilities).
 *   2. The homeowner signs in on their utility's own secure website and
 *      grants access — GridGuide never sees their utility password.
 *   3. The utility redirects back to /api/utility/green-button/callback
 *      with an authorization code.
 *   4. The callback exchanges the code for an access token and begins
 *      fetching ESPI XML data (interval meter reads, billing, rate plan).
 */
import { prisma }              from "@/lib/db.js";
import { ok, err }             from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { redis }               from "@/lib/redis.js";

const APP_URL      = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";
const GB_CLIENT_ID = process.env.GREEN_BUTTON_CLIENT_ID;   // GridGuide's GBC client ID
const REDIRECT_URI = `${APP_URL}/api/utility/green-button/callback`;

// Hardcoded Green Button Share My Data authorization endpoints for major
// U.S. utilities. These are public ESPI OAuth 2.0 authorization URLs.
// The admin can override any of these via UtilityTerritory.greenButtonAuthUrl.
const GB_AUTH_URLS = {
  pge:        "https://sharemydataapi.pge.com/gbc/authorize",
  sce:        "https://secure.sce.com/sso/teserver/smduae/index",
  sdge:       "https://myaccount.sdge.com/portal/ShareMyData",
  eversource: "https://www.eversource.com/gbconnect/authorize",
  national:   "https://gbconnect.nationalgridus.com/authorize",
  coned:      "https://cned.com/greenbutton/authorize",
  pseg:       "https://myaccount.pseg.com/greenbutton/authorize",
  peco:       "https://secure.peco.com/greenbutton/authorize",
  duke:       "https://www.duke-energy.com/api/gb/authorize",
  dominion:   "https://www.dominionenergy.com/MyAccount/GBC/Authorize",
  aps:        "https://www.aps.com/greenbutton/authorize",
  exelon:     "https://secure.comed.com/GreenButton/Authorize",
  xcel:       "https://my.xcelenergy.com/xcelapi/gbc/authorize",
  austin:     "https://greenbutton.austinenergy.com/authorize",
  pse:        "https://pse.com/greenbutton/authorize",
};

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const utilityId = searchParams.get("utilityId") || "";

  if (!utilityId) return err("utilityId required", 400);

  // Look up the utility's GBC authorization URL:
  // 1) Admin-managed UtilityTerritory row (most authoritative)
  // 2) Hardcoded map of well-known utilities
  // 3) Return an error — utility doesn't support Green Button
  const dbUtility = await prisma.utilityTerritory.findFirst({
    where: { OR: [{ name: { contains: utilityId, mode: "insensitive" } }, { shortName: { contains: utilityId, mode: "insensitive" } }] },
    select: { greenButtonAuthUrl: true, name: true, supportsGreenButton: true },
  }).catch(() => null);

  const baseAuthUrl = dbUtility?.greenButtonAuthUrl || GB_AUTH_URLS[utilityId.toLowerCase()];

  if (!baseAuthUrl) {
    return err(
      `${utilityId} doesn't appear to support Green Button Connect. Try connecting via the utility login method instead.`,
      400
    );
  }

  // PKCE state — verifies the callback belongs to this request and this user
  const state = `gbcstate_${auth.user.id}_${Date.now()}`;
  await redis.setEx(`gbc:state:${state}`, 600, JSON.stringify({ userId: auth.user.id, utilityId }));

  // Build the ESPI OAuth 2.0 authorization URL
  const authUrl = new URL(baseAuthUrl);
  authUrl.searchParams.set("response_type",  "code");
  authUrl.searchParams.set("redirect_uri",   REDIRECT_URI);
  authUrl.searchParams.set("state",          state);
  authUrl.searchParams.set("scope",          "FB=1_3_4_5_13_14_39;IntervalDuration=3600;BlockDuration=Daily;HistoryLength=13");
  if (GB_CLIENT_ID) {
    authUrl.searchParams.set("client_id", GB_CLIENT_ID);
  }

  // Log the attempt
  await prisma.utilityConnectionEvent.create({
    data: { userId: auth.user.id, method: "GREEN_BUTTON", success: false, errorMessage: "Pending — user redirected to utility portal" },
  }).catch(() => {});

  return ok({ authUrl: authUrl.toString(), state, utilityId });
}
