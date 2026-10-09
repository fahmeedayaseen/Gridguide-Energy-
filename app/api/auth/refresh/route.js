import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { verifyRefreshToken, signAccessToken, extractRefreshToken } from "@/lib/jwt.js";
import { isBlacklisted } from "@/lib/redis.js";

export async function POST(request) {
  const token = extractRefreshToken(request);
  if (!token) return err("No refresh token", 401);

  // Revoked at logout?
  if (await isBlacklisted(token)) return err("Token revoked", 401);

  // verifyRefreshToken returns null (it does not throw) on a bad signature,
  // expiry, or a non-refresh token type. The previous try/catch never caught
  // anything, so an invalid token crashed on decoded.sub with a 500.
  const decoded = verifyRefreshToken(token);
  if (!decoded?.sub) return err("Invalid or expired refresh token", 401);

  const user = await prisma.user.findUnique({
    where: { id: decoded.sub },
    select: { id: true, email: true, role: true, plan: true },
  });
  if (!user) return err("User not found", 401);

  const accessToken = signAccessToken({
    sub: user.id, email: user.email, role: user.role, plan: user.plan,
  });

  const response = ok({ message: "Token refreshed" });
  // Set new access token cookie only (keep existing refresh token)
  response.headers.set(
    "Set-Cookie",
    `access_token=${accessToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
  return response;
}
