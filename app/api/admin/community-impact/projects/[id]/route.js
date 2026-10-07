/**
 * PATCH  /api/admin/community-impact/projects/[id] — update a project
 * DELETE /api/admin/community-impact/projects/[id] — remove a project
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const updateSchema = z.object({
  title:         z.string().min(1).max(150).optional(),
  description:   z.string().min(1).max(2000).optional(),
  amountFunded:  z.number().positive().optional(),
  recipientName: z.string().max(150).nullable().optional(),
  receiptUrl:    z.string().url().nullable().optional(),
  fundedAt:      z.string().optional(),
  isPublished:   z.boolean().optional(),
}).strict();

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.communityFundProject.findUnique({ where: { id: params.id } });
  if (!existing) return err("Project not found", 404);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const updateData = { ...data };
  if (updateData.fundedAt) updateData.fundedAt = new Date(updateData.fundedAt);

  const updated = await prisma.communityFundProject.update({ where: { id: params.id }, data: updateData });

  await logAudit({
    actorUserId: auth.user.id, actorRole: "ADMIN", action: "COMMUNITY_PROJECT_UPDATED",
    targetType: "CommunityFundProject", targetId: params.id,
    category: "OTHER", metadata: { changes: data },
  });

  return ok({ project: updated, message: "Project updated." });
}

export async function DELETE(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.communityFundProject.findUnique({ where: { id: params.id } });
  if (!existing) return err("Project not found", 404);

  await prisma.communityFundProject.delete({ where: { id: params.id } });

  await logAudit({
    actorUserId: auth.user.id, actorRole: "ADMIN", action: "COMMUNITY_PROJECT_REMOVED",
    targetType: "CommunityFundProject", targetId: params.id,
    category: "OTHER", metadata: { title: existing.title },
  });

  return ok({ message: "Project removed." });
}
