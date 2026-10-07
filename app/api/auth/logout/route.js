import { ok, clearTokenCookies } from "@/lib/auth.js";
import { extractBearer } from "@/lib/jwt.js";
import { blacklistToken } from "@/lib/redis.js";

export async function POST(request) {
  const token = extractBearer(request);
  if (token) await blacklistToken(token, 900); // blacklist for 15 min (access token TTL)

  const response = ok({ message: "Logged out successfully." });
  return clearTokenCookies(response);
}
