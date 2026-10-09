import { ok, clearTokenCookies } from "@/lib/auth.js";
import { extractBearer, extractRefreshToken, decodeUnverified } from "@/lib/jwt.js";
import { blacklistToken } from "@/lib/redis.js";

/**
 * Revoke BOTH tokens on logout. Revoking only the access token left the
 * 7-day refresh token usable, so a copied refresh cookie could keep minting
 * new access tokens after the user signed out.
 *
 * Every authenticated API route checks the revocation list through
 * authenticateRequest() in lib/jwt.js, so the access token stops working on
 * the very next request — not after its 15-minute expiry.
 */
export async function POST(request) {
  const accessToken = extractBearer(request);
  const refreshToken = extractRefreshToken(request);

  await Promise.all([
    blacklistToken(accessToken, 15 * 60, decodeUnverified(accessToken)?.exp),
    blacklistToken(refreshToken, 7 * 24 * 60 * 60, decodeUnverified(refreshToken)?.exp),
  ]);

  const response = ok({ message: "Logged out successfully." });
  return clearTokenCookies(response);
}
