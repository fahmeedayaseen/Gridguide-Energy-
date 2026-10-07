/**
 * GET    /api/installers/interconnection         — list tasks
 * POST   /api/installers/interconnection         — create task
 * PATCH  /api/installers/interconnection?id=     — update status / complete
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const createSchema = z.object({
  jobId:       z.string().optional(),
  leadId:      z.string().optional(),
  utilityName: z.string().min(1),
  taskName:    z.string().min(1),
  taskType:    z.enum(["APPLICATION","ONE_LINE_DIAGRAM","APPROVAL_TO_OPERATE","PERMIT_SUBMISSION","PERMIT_INSPECTION","NET_METERING","OTHER"]).default("OTHER"),
  dueDate:     z.string().optional(),
  notes:       z.string().optional(),
});

const updateSchema = z.object({
  status:      z.enum(["NOT_REQUIRED","NOT_STARTED","PENDING","WAITING","APPROVED","REJECTED","COMPLETED"]).optional(),
  notes:       z.string().optional(),
  dueDate:     z.string().optional(),
  documentUrl: z.string().url().optional(),
}).strict();

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({
    where: { userId: auth.user.id },
  });
  if (!installer) return err("Installer not found", 404);

  const { searchParams } = new URL(request.url);
  const jobId  = searchParams.get("jobId");
  const status = searchParams.get("status");

  const tasks = await prisma.interconnectionTask.findMany({
    where: {
      installerId: installer.id,
      ...(jobId  && { jobId }),
      ...(status && { status }),
    },
    include: {
      job: { select: { id: true, title: true, status: true, address: true } },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });

  // Group by job for the UI
  const byJob = tasks.reduce((acc, t) => {
    const key = t.jobId || "no_job";
    if (!acc[key]) acc[key] = {
      jobId:    t.jobId,
      jobTitle: t.job?.title || "General",
      address:  t.job?.address,
      utility:  t.utilityName,
      tasks:    [],
    };
    acc[key].tasks.push(t);
    return acc;
  }, {});

  const stats = {
    total:     tasks.length,
    pending:   tasks.filter(t => ["PENDING","WAITING","NOT_STARTED"].includes(t.status)).length,
    completed: tasks.filter(t => t.status === "COMPLETED").length,
    overdue:   tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "COMPLETED").length,
  };

  return ok({ tasks, byJob: Object.values(byJob), stats });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({
    where: { userId: auth.user.id },
  });
  if (!installer) return err("Installer not found", 404);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  // Verify job ownership if provided
  if (data.jobId) {
    const job = await prisma.job.findFirst({
      where: { id: data.jobId, installerId: installer.id },
    });
    if (!job) return err("Job not found", 404);
  }

  const task = await prisma.interconnectionTask.create({
    data: {
      installerId: installer.id,
      jobId:       data.jobId,
      leadId:      data.leadId,
      utilityName: data.utilityName,
      taskName:    data.taskName,
      taskType:    data.taskType,
      dueDate:     data.dueDate ? new Date(data.dueDate) : null,
      notes:       data.notes,
      status:      "PENDING",
    },
  });

  // Update job interconnection status
  if (data.jobId) {
    await prisma.job.update({
      where: { id: data.jobId },
      data:  { interconnectionStatus: "pending" },
    }).catch(() => {});
  }

  return ok({ task, message: "Interconnection task created." }, 201);
}

export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("id");
  if (!taskId) return err("Task ID required", 400);

  const installer = await prisma.installer.findUnique({
    where: { userId: auth.user.id },
  });
  if (!installer) return err("Installer not found", 404);

  const task = await prisma.interconnectionTask.findFirst({
    where: { id: taskId, installerId: installer.id },
  });
  if (!task) return err("Task not found", 404);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const updateData = { ...data };
  if (data.status === "COMPLETED" && task.status !== "COMPLETED") {
    updateData.completedAt = new Date();
  }
  if (data.dueDate) updateData.dueDate = new Date(data.dueDate);

  const updated = await prisma.interconnectionTask.update({
    where: { id: taskId },
    data:  updateData,
  });

  // Check if all tasks for this job are complete → update job interconnection status
  if (task.jobId && data.status === "COMPLETED") {
    const remaining = await prisma.interconnectionTask.count({
      where: { jobId: task.jobId, status: { notIn: ["COMPLETED","NOT_REQUIRED"] } },
    });
    if (remaining === 0) {
      await prisma.job.update({
        where: { id: task.jobId },
        data:  { interconnectionStatus: "approved" },
      }).catch(() => {});
    }
  }

  return ok({ task: updated });
}
