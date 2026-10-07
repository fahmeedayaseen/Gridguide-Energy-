import { prisma } from "@/lib/db.js";
import { verifyPassword, loginSchema, parseBody, ok, err, setTokenCookies } from "@/lib/auth.js";
import { issueTokens } from "@/lib/jwt.js";
import { rateLimit } from "@/lib/redis.js";
import { resolveEnterpriseAccess } from "@/lib/enterprise-permissions.js";

export async function POST(request) {
  // Rate limit: 10 login attempts per 15 min per IP
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const { allowed, remaining } = await rateLimit(`login:${ip}`, 10, 900);
  if (!allowed) {
    return err("Too many login attempts. Please wait 15 minutes.", 429);
  }

  const { data, error } = await parseBody(request, loginSchema);
  if (error) return err("Invalid request body", 400, error);

  const { email, password } = data;

  // Fetch user with password hash
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true, name: true, email: true,
      role: true, plan: true, passwordHash: true,
      emailVerified: true, avatar: true,
      personalReferralCode: true,
      utilityProvider: true,   // fix: include so DashUtility shows on login
      utilityConnected: true,  // without this, returning users see "not connected"
    },
  });

  // Timing-safe: always run bcrypt even if user not found
  const hash = user?.passwordHash || "$2b$12$invalidhashtopreventtiming";
  const valid = await verifyPassword(password, hash);

  if (!user || !valid) {
    return err("Invalid email or password.", 401);
  }

  // Strip hash before returning
  const { passwordHash: _, ...safeUser } = user;

  const tokens = issueTokens(safeUser);

  // Record last login + activity
  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt:  new Date(),
      lastActiveAt: new Date(),
      sessionCount: { increment: 1 },
    },
  });
  // Activity log (non-blocking)
  prisma.userActivityLog.create({
    data: { userId: user.id, action: "login" },
  }).catch(() => {});

  const response = ok({
    user: safeUser,
    enterpriseAccess: await resolveEnterpriseAccess(user.id).then((a) => a ? { role: a.role, orgId: a.org.id } : null),
    message: "Logged in successfully.",
  });
  return setTokenCookies(response, tokens);
}
