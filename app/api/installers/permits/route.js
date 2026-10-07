/**
 * GET    /api/installers/permits       — list permits
 * POST   /api/installers/permits       — create permit record
 * PATCH  /api/installers/permits?id=   — update status
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const createSchema = z.object({
  jobId:        z.string().optional(),
  permitType:   z.string(),
  jurisdiction: z.string(),
  permitNumber: z.string().optional(),
  notes:        z.string().optional(),
});

const updateSchema = z.object({
  status:       z.enum(["NOT_STARTED","NOT_REQUIRED","PENDING","SUBMITTED","APPROVED","FAILED_INSPECTION","COMPLETE"]).optional(),
  permitNumber: z.string().optional(),
  submittedAt:  z.string().optional(),
  approvedAt:   z.string().optional(),
  expiresAt:    z.string().optional(),
  inspectionAt: z.string().optional(),
  documentUrl:  z.string().optional(),
  notes:        z.string().optional(),
}).strict();

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");

  const permits = await prisma.permit.findMany({
    where: { installerId: installer.id, ...(jobId && { jobId }) },
    include: { job: { select: { title: true, address: true } } },
    orderBy: { createdAt: "desc" },
  });

  return ok({ permits });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  const permit = await prisma.permit.create({
    data: { installerId: installer.id, ...data, status: "PENDING" },
  });

  if (data.jobId) {
    await prisma.job.update({
      where: { id: data.jobId },
      data:  { permitStatus: "pending" },
    }).catch(() => {});
  }

  return ok({ permit }, 201);
}

export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const permitId = searchParams.get("id");
  if (!permitId) return err("Permit ID required", 400);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);

  const permit = await prisma.permit.findFirst({ where: { id: permitId, installerId: installer.id } });
  if (!permit) return err("Permit not found", 404);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const updateData = { ...data };
  if (data.submittedAt) updateData.submittedAt = new Date(data.submittedAt);
  if (data.approvedAt)  updateData.approvedAt  = new Date(data.approvedAt);
  if (data.expiresAt)   updateData.expiresAt   = new Date(data.expiresAt);
  if (data.inspectionAt)updateData.inspectionAt= new Date(data.inspectionAt);

  const updated = await prisma.permit.update({ where: { id: permitId }, data: updateData });

  // Sync job permit status
  if (permit.jobId && data.status) {
    const statusMap = { APPROVED:"approved", SUBMITTED:"pending", NOT_REQUIRED:"not_required", COMPLETE:"approved" };
    const jobStatus = statusMap[data.status] || "pending";
    await prisma.job.update({ where: { id: permit.jobId }, data: { permitStatus: jobStatus } }).catch(() => {});
  }

  return ok({ permit: updated });
}
