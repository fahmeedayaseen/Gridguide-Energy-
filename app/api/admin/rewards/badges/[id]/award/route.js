/**
 * POST /api/admin/rewards/badges/[id]/award — manually award this badge
 * to a specific user by email. Works for any badge (AUTO or MANUAL) as
 * an admin override, but is the ONLY way a MANUAL badge is ever granted.
 * The findUnique check below is a fast, friendly error for the common
 * case; lib/rewards-engine.js's awardBadgeManually is the real atomic
 * guarantee underneath it, since two concurrent award attempts could
 * both pass this check before either commits.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { awardBadgeManually } from "@/lib/rewards-engine.js";
import { z } from "zod";

const schema = z.object({ email: z.string().email() });

export async function POST(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const badge = await prisma.badge.findUnique({ where: { id: params.id } });
  if (!badge) return err("Badge not found", 404);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) return err("No account found with that email.", 404);

  const existing = await prisma.userBadge.findUnique({ where: { userId_badgeId: { userId: user.id, badgeId: badge.id } } });
  if (existing) return err(`${user.name} already has this badge.`, 409);

  try {
    await awardBadgeManually(user.id, badge.id, auth.user.id);
  } catch (e) {
    return err(e.message, 400);
  }

  return ok({ message: `"${badge.name}" awarded to ${user.name}.` }, 201);
}
