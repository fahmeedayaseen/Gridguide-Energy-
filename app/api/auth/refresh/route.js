import { prisma } from "@/lib/db.js";
import { ok, err, setTokenCookies } from "@/lib/auth.js";
import { verifyRefreshToken, signAccessToken } from "@/lib/jwt.js";
import { isBlacklisted } from "@/lib/redis.js";

export async function POST(request) {
  // Pull refresh token from cookie
  const cookies = request.headers.get("cookie") || "";
  const match   = cookies.match(/refresh_token=([^;]+)/);
  const token   = match?.[1];

  if (!token) return err("No refresh token", 401);

  // Check blacklist
  if (await isBlacklisted(token)) return err("Token revoked", 401);

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    return err("Invalid or expired refresh token", 401);
  }

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
    `access_token=${accessToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
  return response;
}
