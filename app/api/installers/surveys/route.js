/**
 * GET  /api/installers/surveys           — list user's site surveys
 * POST /api/installers/surveys           — schedule a site survey
 * PATCH /api/installers/surveys?id=      — confirm / cancel / complete
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const createSchema = z.object({
  installerId: z.string().optional(),
  quoteId:     z.string().optional(),
  scheduledAt: z.string().datetime(),
  timeSlot:    z.string(),                         // "9:00 AM"
  notes:       z.string().max(1000).optional(),
});

const updateSchema = z.object({
  status: z.enum(["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const surveys = await prisma.siteSurvey.findMany({
    where:   { userId: auth.user.id },
    orderBy: { scheduledAt: "desc" },
    take:    20,
    include: {
      installer: { select: { companyName: true, rating: true } },
    },
  });

  return ok({ surveys });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  // Validate scheduled date is in the future
  if (new Date(data.scheduledAt) <= new Date()) {
    return err("Survey must be scheduled for a future date.", 400);
  }

  const survey = await prisma.siteSurvey.create({
    data: {
      userId:      auth.user.id,
      installerId: data.installerId || null,
      quoteId:     data.quoteId    || null,
      scheduledAt: new Date(data.scheduledAt),
      timeSlot:    data.timeSlot,
      notes:       data.notes || null,
      status:      "SCHEDULED",
    },
    include: {
      installer: { select: { companyName: true } },
    },
  });

  return ok({ survey, message: `Site survey scheduled for ${new Date(data.scheduledAt).toLocaleDateString()} at ${data.timeSlot}.` }, 201);
}

export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return err("Survey ID required.", 400);

  const existing = await prisma.siteSurvey.findFirst({ where: { id, userId: auth.user.id } });
  if (!existing) return err("Survey not found.", 404);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const updated = await prisma.siteSurvey.update({
    where: { id },
    data: {
      status:      data.status,
      confirmedAt: data.status === "CONFIRMED"  ? new Date() : undefined,
      completedAt: data.status === "COMPLETED"  ? new Date() : undefined,
    },
  });

  return ok({ survey: updated, message: `Survey ${data.status.toLowerCase()}.` });
}
