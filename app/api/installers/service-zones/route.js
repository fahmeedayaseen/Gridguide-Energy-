/**
 * GET    /api/installers/service-zones       — list service zones
 * POST   /api/installers/service-zones       — add zone
 * DELETE /api/installers/service-zones?id=   — remove zone
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const createSchema = z.object({
  city:        z.string().min(1),
  state:       z.string().length(2),
  zipCode:     z.string().optional(),
  radiusMiles: z.number().int().min(1).max(200).default(25),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);
  const zones = await prisma.serviceZone.findMany({
    where: { installerId: installer.id, active: true },
    orderBy: { createdAt: "asc" },
  });
  return ok({ zones });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);
  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);
  const zone = await prisma.serviceZone.create({
    data: { installerId: installer.id, ...data },
  });
  return ok({ zone, message: "Service zone added." }, 201);
}

export async function DELETE(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const { searchParams } = new URL(request.url);
  const zoneId = searchParams.get("id");
  if (!zoneId) return err("Zone ID required", 400);
  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);
  const zone = await prisma.serviceZone.findFirst({ where: { id: zoneId, installerId: installer.id } });
  if (!zone) return err("Service zone not found", 404);
  await prisma.serviceZone.update({ where: { id: zoneId }, data: { active: false } });
  return ok({ message: "Service zone removed." });
}
