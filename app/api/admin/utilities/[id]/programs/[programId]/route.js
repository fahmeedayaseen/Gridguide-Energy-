/**
 * PATCH  /api/admin/utilities/[id]/programs/[programId]  — edit a program
 * DELETE /api/admin/utilities/[id]/programs/[programId]  — remove a program
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  category: z.enum(["DEMAND_RESPONSE", "VPP", "SOLAR", "BATTERY", "EV", "ENERGY_EFFICIENCY"]).optional(),
  description: z.string().nullable().optional(),
  url: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
}).strict();

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.utilityProgram.findFirst({ where: { id: params.programId, utilityId: params.id } });
  if (!existing) return err("Program not found", 404);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const program = await prisma.utilityProgram.update({ where: { id: params.programId }, data });
  return ok({ program, message: "Program updated." });
}

export async function DELETE(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.utilityProgram.findFirst({ where: { id: params.programId, utilityId: params.id } });
  if (!existing) return err("Program not found", 404);

  await prisma.utilityProgram.delete({ where: { id: params.programId } });
  return ok({ message: "Program removed." });
}
