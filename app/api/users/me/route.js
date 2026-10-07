import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";
import { getMembership } from "@/lib/memberships.js";
import { resolveEnterpriseAccess } from "@/lib/enterprise-permissions.js";

const updateSchema = z.object({
  name:   z.string().min(2).max(100).optional(),
  phone:  z.string().optional(),
  avatar: z.string().url().optional(),
}).strict();

// GET /api/users/me — full profile with related data
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: {
      id: true, name: true, email: true, phone: true,
      avatar: true, role: true, plan: true, planExpiresAt: true, membershipStatus: true,
      emailVerified: true, createdAt: true, personalReferralCode: true,
      rewards:  { select: { points: true, tier: true, lifetimePoints: true } },
      devices:  { select: { id: true, type: true, manufacturer: true, model: true, status: true } },
      thermostat: { select: { brand: true, currentTemp: true, targetTemp: true, mode: true, aiOptimize: true } },
      vppEnrollment: { select: { active: true, enrolledAt: true } },
      _count:   { select: { orders: true, rebateClaims: true, aiChats: true } },
    },
  });

  if (!user) return err("User not found", 404);
  const enterpriseAccess = await resolveEnterpriseAccess(auth.user.id).then((a) => a ? { role: a.role, orgId: a.org.id } : null);
  return ok({ user: { ...user, membership: getMembership(user.plan) }, enterpriseAccess });
}

// PATCH /api/users/me — update profile
export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data,
    select: { id: true, name: true, email: true, phone: true, avatar: true },
  });

  return ok({ user, message: "Profile updated." });
}
