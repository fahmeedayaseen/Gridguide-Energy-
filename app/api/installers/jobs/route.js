/**
 * GET    /api/installers/jobs         — list jobs with full detail
 * POST   /api/installers/jobs         — create job manually
 * PATCH  /api/installers/jobs?id=     — update status, permit, interconnection
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";
import { getInstallerSuccessFeeRate, computeInstallerSuccessFee } from "@/lib/platform-config.js";

const createSchema = z.object({
  leadId:       z.string().optional(),
  title:        z.string().min(1),
  jobType:      z.string().optional(),
  address:      z.string(),
  scheduledAt:  z.string().optional(),
  projectValue: z.number().positive(),
  notes:        z.string().optional(),
});

const updateSchema = z.object({
  status:               z.enum(["SCHEDULED","IN_PROGRESS","COMPLETED","CANCELLED","DISPUTED"]).optional(),
  jobType:              z.string().optional(),
  scheduledAt:          z.string().optional(),
  completedAt:          z.string().optional(),
  permitStatus:         z.string().optional(),
  interconnectionStatus:z.string().optional(),
  notes:                z.string().optional(),
  projectValue:         z.number().positive().optional(),
}).strict();

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const jobs = await prisma.job.findMany({
    where: {
      installerId: installer.id,
      ...(status && { status }),
    },
    include: {
      lead: {
        select: {
          id: true, customerName: true, customerEmail: true,
          customerPhone: true, projectType: true, address: true,
        },
      },
      payout:               { select: { netAmount: true, status: true } },
      interconnectionTasks: { select: { id: true, taskName: true, status: true, utilityName: true } },
      permits:              { select: { id: true, permitType: true, status: true } },
    },
    orderBy: { scheduledAt: "asc" },
  });

  const stats = {
    total:        jobs.length,
    scheduled:    jobs.filter(j => j.status === "SCHEDULED").length,
    completed:    jobs.filter(j => j.status === "COMPLETED").length,
    inProgress:   jobs.filter(j => j.status === "IN_PROGRESS").length,
    totalValue:   jobs.reduce((a, j) => a + j.projectValue, 0),
    pendingPermit:jobs.filter(j => j.permitStatus === "pending").length,
    pendingIC:    jobs.filter(j => ["pending","waiting"].includes(j.interconnectionStatus)).length,
  };

  return ok({ jobs, stats });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  // Lead success fee is tiered by plan (Free 10% · Pro 7% · Enterprise 5%,
  // admin-adjustable) — single source of truth in lib/platform-config.js.
  // Only GridGuide-generated leads carry a fee, not self-sourced jobs.
  if (data.leadId) {
    const lead = await prisma.installerLead.findFirst({
      where: { id: data.leadId, installerId: installer.id },
      select: { id: true },
    });
    if (!lead) return err("Lead not found", 404);
  }
  const isGridGuideLead = !!data.leadId;
  const successFeeRate = isGridGuideLead ? await getInstallerSuccessFeeRate(installer.plan) : 0;
  const successFee = computeInstallerSuccessFee(data.projectValue, successFeeRate, { gridGuideSourced: isGridGuideLead });

  const job = await prisma.job.create({
    data: {
      installerId:    installer.id,
      leadId:         data.leadId,
      title:          data.title,
      jobType:        data.jobType,
      address:        data.address,
      scheduledAt:    data.scheduledAt ? new Date(data.scheduledAt) : null,
      projectValue:   data.projectValue,
      successFee,
      successFeeRate, // record which plan tier's rate was applied at creation time
      notes:          data.notes,
      status:         "SCHEDULED",
    },
  });

  return ok({ job, message: "Job created." }, 201);
}

export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("id");
  if (!jobId) return err("Job ID required", 400);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);

  const job = await prisma.job.findFirst({ where: { id: jobId, installerId: installer.id } });
  if (!job) return err("Job not found", 404);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const updateData = { ...data };
  if (data.scheduledAt) updateData.scheduledAt = new Date(data.scheduledAt);
  if (data.completedAt) updateData.completedAt = new Date(data.completedAt);

  // On completion: create payout record
  if (data.status === "COMPLETED" && job.status !== "COMPLETED") {
    updateData.completedAt = updateData.completedAt || new Date();
    const netAmount = job.projectValue - job.successFee;

    await prisma.installerPayout.upsert({
      where:  { jobId: job.id },
      create: {
        installerId: installer.id,
        jobId:       job.id,
        grossAmount: job.projectValue,
        feeAmount:   job.successFee,
        netAmount,
        status:      "PENDING",
      },
      update: { status: "PENDING" },
    }).catch(() => {});

    // Update installer totals
    await prisma.installer.update({
      where: { id: installer.id },
      data: {
        jobsCompleted: { increment: 1 },
        totalEarnings: { increment: netAmount },
      },
    }).catch(() => {});
  }

  const updated = await prisma.job.update({
    where: { id: jobId },
    data:  updateData,
    include: {
      lead:                 { select: { customerName: true } },
      interconnectionTasks: { select: { taskName: true, status: true } },
      permits:              { select: { permitType: true, status: true } },
    },
  });

  return ok({ job: updated });
}
