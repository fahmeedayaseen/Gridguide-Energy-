/**
 * PATCH  /api/admin/rewards/tiers/[id] — edit a tier
 * DELETE /api/admin/rewards/tiers/[id] — remove a tier
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1).max(50).optional(),
  minPoints: z.number().int().min(0).optional(),
  discountPct: z.number().min(0).max(1).optional(),
  perks: z.string().max(500).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  sortOrder: z.number().int().optional(),
}).strict();

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.rewardTier.findUnique({ where: { id: params.id } });
  if (!existing) return err("Tier not found", 404);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const tier = await prisma.rewardTier.update({ where: { id: params.id }, data });

  await logAudit({ actorUserId: auth.user.id, actorRole: "ADMIN", action: "REWARD_TIER_UPDATED", targetType: "RewardTier", targetId: params.id, category: "OTHER", metadata: { changes: data } });

  return ok({ tier, message: "Tier updated." });
}

export async function DELETE(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.rewardTier.findUnique({ where: { id: params.id } });
  if (!existing) return err("Tier not found", 404);

  await prisma.rewardTier.delete({ where: { id: params.id } });

  await logAudit({ actorUserId: auth.user.id, actorRole: "ADMIN", action: "REWARD_TIER_REMOVED", targetType: "RewardTier", targetId: params.id, category: "OTHER", metadata: { name: existing.name } });

  return ok({ message: "Tier removed." });
}
