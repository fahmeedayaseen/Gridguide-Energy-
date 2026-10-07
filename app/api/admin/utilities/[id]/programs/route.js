/**
 * GET  /api/admin/utilities/[id]/programs  — list a utility's DR/VPP/solar/battery/EV programs
 * POST /api/admin/utilities/[id]/programs  — add a program
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(2),
  category: z.enum(["DEMAND_RESPONSE", "VPP", "SOLAR", "BATTERY", "EV", "ENERGY_EFFICIENCY"]),
  description: z.string().optional(),
  url: z.string().url().optional(),
  isActive: z.boolean().optional().default(true),
}).strict();

export async function GET(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const programs = await prisma.utilityProgram.findMany({
    where: { utilityId: params.id },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return ok({ programs });
}

export async function POST(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const utility = await prisma.utilityTerritory.findUnique({ where: { id: params.id } });
  if (!utility) return err("Utility not found", 404);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  const program = await prisma.utilityProgram.create({ data: { ...data, utilityId: params.id } });
  return ok({ program, message: "Program added." }, 201);
}
