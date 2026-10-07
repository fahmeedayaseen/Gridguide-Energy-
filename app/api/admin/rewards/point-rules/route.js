/**
 * GET  /api/admin/rewards/point-rules — list all point rules
 * POST /api/admin/rewards/point-rules — create a new rule
 *
 * actionCode is the key award call sites (lib/rewards-engine.js's
 * awardPoints) look up - creating a rule here with a new actionCode alone
 * does NOT make anything award it; a call site still has to call
 * awardPoints(userId, actionCode) somewhere in the codebase. This CRUD
 * only controls the point VALUE and active state for actions the
 * platform already calls out to.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const schema = z.object({
  actionCode: z.string().min(1).max(80).regex(/^[A-Z0-9_]+$/, "Use uppercase letters, numbers, and underscores only."),
  label: z.string().min(1).max(150),
  points: z.number().int(),
  isActive: z.boolean().default(true),
});

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const rules = await prisma.pointRule.findMany({ orderBy: { actionCode: "asc" } });
  return ok({ rules });
}

export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, schema);
  if (error) return err(error.errors?.[0]?.message || "Validation failed", 400, error);

  const existing = await prisma.pointRule.findUnique({ where: { actionCode: data.actionCode } });
  if (existing) return err("A rule for this action code already exists.", 409);

  const rule = await prisma.pointRule.create({ data });

  await logAudit({ actorUserId: auth.user.id, actorRole: "ADMIN", action: "POINT_RULE_CREATED", targetType: "PointRule", targetId: rule.id, category: "OTHER", metadata: data });

  return ok({ rule, message: "Point rule created." }, 201);
}
