/**
 * GET  /api/admin/rewards/badges — list all badges
 * POST /api/admin/rewards/badges — create a badge
 *
 * triggerType "AUTO" requires triggerActionCode + triggerThreshold - the
 * badge unlocks itself once a user's count of RewardTransaction rows with
 * that actionCode reaches the threshold (checked in
 * lib/rewards-engine.js's checkAndAwardBadges, called every time
 * awardPoints() runs for that action). "MANUAL" badges have no automatic
 * trigger - only POST .../badges/[id]/award grants them.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  iconName: z.string().max(50).default("award"),
  triggerType: z.enum(["AUTO", "MANUAL"]),
  triggerActionCode: z.string().max(80).optional(),
  triggerThreshold: z.number().int().positive().optional(),
  bonusPoints: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
}).refine(
  (d) => d.triggerType !== "AUTO" || (d.triggerActionCode && d.triggerThreshold),
  { message: "AUTO badges require triggerActionCode and triggerThreshold." }
);

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const badges = await prisma.badge.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { userBadges: true } } },
  });
  return ok({ badges });
}

export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, schema);
  if (error) return err(error.errors?.[0]?.message || "Validation failed", 400, error);

  const badge = await prisma.badge.create({ data });

  await logAudit({ actorUserId: auth.user.id, actorRole: "ADMIN", action: "BADGE_CREATED", targetType: "Badge", targetId: badge.id, category: "OTHER", metadata: data });

  return ok({ badge, message: "Badge created." }, 201);
}
