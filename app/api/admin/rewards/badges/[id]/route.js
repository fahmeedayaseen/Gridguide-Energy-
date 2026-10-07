/**
 * PATCH  /api/admin/rewards/badges/[id] — edit a badge (including
 *        enable/disable via isActive)
 * DELETE /api/admin/rewards/badges/[id] — remove a badge entirely
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  iconName: z.string().max(50).optional(),
  triggerActionCode: z.string().max(80).nullable().optional(),
  triggerThreshold: z.number().int().positive().nullable().optional(),
  bonusPoints: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).strict();

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.badge.findUnique({ where: { id: params.id } });
  if (!existing) return err("Badge not found", 404);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const badge = await prisma.badge.update({ where: { id: params.id }, data });

  await logAudit({ actorUserId: auth.user.id, actorRole: "ADMIN", action: "BADGE_UPDATED", targetType: "Badge", targetId: params.id, category: "OTHER", metadata: { changes: data } });

  return ok({ badge, message: "Badge updated." });
}

export async function DELETE(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.badge.findUnique({ where: { id: params.id } });
  if (!existing) return err("Badge not found", 404);

  await prisma.badge.delete({ where: { id: params.id } });

  await logAudit({ actorUserId: auth.user.id, actorRole: "ADMIN", action: "BADGE_REMOVED", targetType: "Badge", targetId: params.id, category: "OTHER", metadata: { name: existing.name } });

  return ok({ message: "Badge removed." });
}
