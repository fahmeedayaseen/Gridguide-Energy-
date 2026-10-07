/**
 * PATCH  /api/admin/rewards/point-rules/[id] — edit a rule (e.g. change
 *        the point value, or toggle isActive)
 * DELETE /api/admin/rewards/point-rules/[id] — remove a rule
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const schema = z.object({
  label: z.string().min(1).max(150).optional(),
  points: z.number().int().optional(),
  isActive: z.boolean().optional(),
}).strict();

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.pointRule.findUnique({ where: { id: params.id } });
  if (!existing) return err("Rule not found", 404);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const rule = await prisma.pointRule.update({ where: { id: params.id }, data });

  await logAudit({ actorUserId: auth.user.id, actorRole: "ADMIN", action: "POINT_RULE_UPDATED", targetType: "PointRule", targetId: params.id, category: "OTHER", metadata: { changes: data } });

  return ok({ rule, message: "Rule updated." });
}

export async function DELETE(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.pointRule.findUnique({ where: { id: params.id } });
  if (!existing) return err("Rule not found", 404);

  await prisma.pointRule.delete({ where: { id: params.id } });

  await logAudit({ actorUserId: auth.user.id, actorRole: "ADMIN", action: "POINT_RULE_REMOVED", targetType: "PointRule", targetId: params.id, category: "OTHER", metadata: { actionCode: existing.actionCode } });

  return ok({ message: "Rule removed." });
}
