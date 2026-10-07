/**
 * PATCH  /api/admin/utilities/[id]/rate-plans/[rateId]  — edit a rate plan
 * DELETE /api/admin/utilities/[id]/rate-plans/[rateId]  — remove a rate plan
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  isTou: z.boolean().optional(),
  peakRate: z.number().nonnegative().nullable().optional(),
  offPeakRate: z.number().nonnegative().nullable().optional(),
  isEvRate: z.boolean().optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
}).strict();

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.utilityRatePlan.findFirst({ where: { id: params.rateId, utilityId: params.id } });
  if (!existing) return err("Rate plan not found", 404);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const ratePlan = await prisma.utilityRatePlan.update({ where: { id: params.rateId }, data });
  return ok({ ratePlan, message: "Rate plan updated." });
}

export async function DELETE(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.utilityRatePlan.findFirst({ where: { id: params.rateId, utilityId: params.id } });
  if (!existing) return err("Rate plan not found", 404);

  await prisma.utilityRatePlan.delete({ where: { id: params.rateId } });
  return ok({ message: "Rate plan removed." });
}
