/**
 * GET  /api/admin/community-impact/projects — list all (published + unpublished)
 * POST /api/admin/community-impact/projects — add a funded project entry
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const createSchema = z.object({
  title:         z.string().min(1).max(150),
  description:   z.string().min(1).max(2000),
  amountFunded:  z.number().positive(),
  recipientName: z.string().max(150).optional(),
  receiptUrl:    z.string().url().optional(),
  fundedAt:      z.string().optional(),
  isPublished:   z.boolean().default(true),
});

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const projects = await prisma.communityFundProject.findMany({ orderBy: { fundedAt: "desc" } });
  return ok({ projects });
}

export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  const project = await prisma.communityFundProject.create({
    data: {
      ...data,
      fundedAt: data.fundedAt ? new Date(data.fundedAt) : new Date(),
      createdByUserId: auth.user.id,
    },
  });

  await logAudit({
    actorUserId: auth.user.id, actorRole: "ADMIN", action: "COMMUNITY_PROJECT_ADDED",
    targetType: "CommunityFundProject", targetId: project.id,
    category: "OTHER", metadata: { title: project.title, amountFunded: project.amountFunded },
  });

  return ok({ project, message: "Project added." }, 201);
}
