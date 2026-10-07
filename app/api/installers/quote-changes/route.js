/**
 * POST /api/installers/quote-changes      — submit a change request
 * GET  /api/installers/quote-changes      — list user's change requests
 * PATCH /api/installers/quote-changes?id= — installer resolves a request
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const createSchema = z.object({
  installerId: z.string().optional(),
  quoteId:     z.string().optional(),
  message:     z.string().min(10).max(2000),
});

const resolveSchema = z.object({
  status:     z.enum(["IN_REVIEW", "REVISED", "DECLINED"]),
  resolution: z.string().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const requests = await prisma.quoteChangeRequest.findMany({
    where:   { userId: auth.user.id },
    orderBy: { createdAt: "desc" },
    take:    20,
    include: {
      installer: { select: { companyName: true } },
    },
  });

  return ok({ requests });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  const changeRequest = await prisma.quoteChangeRequest.create({
    data: {
      userId:      auth.user.id,
      installerId: data.installerId || null,
      quoteId:     data.quoteId    || null,
      message:     data.message,
      status:      "PENDING",
    },
    include: {
      installer: { select: { companyName: true } },
    },
  });

  return ok({
    request: changeRequest,
    message: "Change request sent. The installer will respond within 1–2 business days.",
  }, 201);
}

export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  // Installers only
  if (auth.user.role !== "INSTALLER" && auth.user.role !== "ADMIN") {
    return err("Only installers can resolve change requests.", 403);
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return err("Request ID required.", 400);

  const { data, error } = await parseBody(request, resolveSchema);
  if (error) return err("Validation failed", 400, error);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  const existing = await prisma.quoteChangeRequest.findFirst({
    where: { id, ...(installer ? { installerId: installer.id } : {}) },
  });
  if (!existing) return err("Change request not found.", 404);

  const updated = await prisma.quoteChangeRequest.update({
    where: { id },
    data: {
      status:     data.status,
      resolution: data.resolution || null,
      resolvedAt: ["REVISED", "DECLINED"].includes(data.status) ? new Date() : undefined,
    },
  });

  return ok({ request: updated, message: `Change request marked as ${data.status.toLowerCase()}.` });
}
