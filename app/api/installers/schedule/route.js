import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const scheduleJobSchema = z.object({
  jobId:       z.string(),
  scheduledAt: z.string().datetime(),
  notes:       z.string().optional(),
});

// GET /api/installers/schedule — jobs for the current week
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer account not found.", 404);

  const { searchParams } = new URL(request.url);
  const weekStr = searchParams.get("week"); // ISO date string for start of week

  const weekStart = weekStr ? new Date(weekStr) : getMonday(new Date());
  const weekEnd   = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const jobs = await prisma.job.findMany({
    where: {
      installerId: installer.id,
      OR: [
        { scheduledAt: { gte: weekStart, lt: weekEnd } },
        { status: { in: ["SCHEDULED","IN_PROGRESS"] } }, // always show active jobs
      ],
    },
    include: {
      lead: { select: { customerName: true, customerEmail: true, customerPhone: true } },
    },
    orderBy: { scheduledAt: "asc" },
  });

  // Group by day
  const byDay = {};
  for (const job of jobs) {
    const day = job.scheduledAt
      ? job.scheduledAt.toISOString().split("T")[0]
      : "unscheduled";
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(job);
  }

  return ok({ jobs, byDay, weekStart, weekEnd });
}

// PATCH /api/installers/schedule — reschedule a job
export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer account not found.", 404);

  const { data, error } = await parseBody(request, scheduleJobSchema);
  if (error) return err("Validation failed", 400, error);

  // Verify job belongs to this installer
  const job = await prisma.job.findFirst({
    where: { id: data.jobId, installerId: installer.id },
  });
  if (!job) return err("Job not found.", 404);

  const updated = await prisma.job.update({
    where: { id: data.jobId },
    data:  { scheduledAt: new Date(data.scheduledAt) },
  });

  return ok({ job: updated, message: "Job rescheduled." });
}

function getMonday(date) {
  const d   = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
