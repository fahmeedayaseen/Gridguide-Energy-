import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { getMembership } from "@/lib/memberships.js";

// GET /api/memberships/status — current logged-in user's membership, limits, and links
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: {
      id: true,
      email: true,
      plan: true,
      planExpiresAt: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      membershipStatus: true,
      _count: { select: { devices: true, aiChats: true } },
    },
  });

  if (!user) return err("User not found", 404);
  const membership = getMembership(user.plan);

  return ok({
    membership: {
      plan: user.plan,
      status: user.membershipStatus || "active",
      planExpiresAt: user.planExpiresAt,
      limits: membership.limits,
      usage: {
        devices: user._count.devices,
        aiChats: user._count.aiChats,
      },
    },
  });
}
