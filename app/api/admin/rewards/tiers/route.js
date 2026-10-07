/**
 * GET  /api/admin/rewards/tiers — list all reward tiers
 * POST /api/admin/rewards/tiers — create a new tier
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1).max(50),
  minPoints: z.number().int().min(0),
  discountPct: z.number().min(0).max(1).default(0),
  perks: z.string().max(500).optional(),
  color: z.string().max(20).optional(),
  sortOrder: z.number().int().default(0),
});

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const tiers = await prisma.rewardTier.findMany({ orderBy: { sortOrder: "asc" } });
  return ok({ tiers });
}

export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const existing = await prisma.rewardTier.findUnique({ where: { name: data.name } });
  if (existing) return err("A tier with this name already exists.", 409);

  const tier = await prisma.rewardTier.create({ data });

  await logAudit({ actorUserId: auth.user.id, actorRole: "ADMIN", action: "REWARD_TIER_CREATED", targetType: "RewardTier", targetId: tier.id, category: "OTHER", metadata: data });

  return ok({ tier, message: "Tier created." }, 201);
}
