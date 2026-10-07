/**
 * GET  /api/admin/utilities/[id]/rate-plans  — list a utility's rate plans (incl. TOU)
 * POST /api/admin/utilities/[id]/rate-plans  — add a rate plan
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1),
  isTou: z.boolean().optional().default(false),
  peakRate: z.number().nonnegative().nullable().optional(),
  offPeakRate: z.number().nonnegative().nullable().optional(),
  isEvRate: z.boolean().optional().default(false),
  description: z.string().optional(),
  isActive: z.boolean().optional().default(true),
}).strict();

export async function GET(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const ratePlans = await prisma.utilityRatePlan.findMany({
    where: { utilityId: params.id },
    orderBy: { name: "asc" },
  });
  return ok({ ratePlans });
}

export async function POST(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const utility = await prisma.utilityTerritory.findUnique({ where: { id: params.id } });
  if (!utility) return err("Utility not found", 404);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  const ratePlan = await prisma.utilityRatePlan.create({ data: { ...data, utilityId: params.id } });
  return ok({ ratePlan, message: "Rate plan added." }, 201);
}
