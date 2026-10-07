/**
 * GET    /api/admin/utilities/[id]  — full utility detail (programs, incentives, rate plans, recent connection events)
 * PATCH  /api/admin/utilities/[id]  — edit a utility, including connection-method / API / Green Button settings
 * DELETE /api/admin/utilities/[id]  — disable a utility (soft-disable; never hard-deletes, to preserve
 *                                      referential history in UtilityAccount/UtilityConnectionEvent)
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const connectionTypeEnum = z.enum([
  "MANUAL","GREEN_BUTTON","DERAPI","UTILITY_API","CSV_UPLOAD","BAYOU","ARCADIA",
  "BILL_UPLOAD","TESLA","ENPHASE","SOLAREDGE","SPAN","EMPORIA","SMARTTHINGS","AMAZON_ALEXA",
]);

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  shortName: z.string().min(1).optional(),
  state: z.string().length(2).optional(),
  eiaid: z.string().nullable().optional(),
  type: z.string().optional(),
  iso: z.string().nullable().optional(),
  website: z.string().url().nullable().optional(),
  customerPortalUrl: z.string().url().nullable().optional(),
  phone: z.string().nullable().optional(),
  supportsGreenButton: z.boolean().optional(),
  supportsArcadia: z.boolean().optional(),
  supportsDirectApi: z.boolean().optional(),
  supportsManualUpload: z.boolean().optional(),
  preferredConnectionMethod: connectionTypeEnum.nullable().optional(),
  greenButtonAuthUrl: z.string().url().nullable().optional(),
  arcadiaUtilityId: z.string().nullable().optional(),
  directApiProvider: z.string().nullable().optional(),
  directApiBaseUrl: z.string().url().nullable().optional(),
  vppEligible: z.boolean().optional(),
  netMeteringAvailable: z.boolean().optional(),
  touRatesAvailable: z.boolean().optional(),
  demandResponseAvailable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  minLat: z.number().nullable().optional(),
  maxLat: z.number().nullable().optional(),
  minLng: z.number().nullable().optional(),
  maxLng: z.number().nullable().optional(),
}).strict();

export async function GET(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const utility = await prisma.utilityTerritory.findUnique({
    where: { id: params.id },
    include: {
      programs: { orderBy: { category: "asc" } },
      incentives: { orderBy: { category: "asc" } },
      ratePlans: true,
      connectionEvents: { orderBy: { createdAt: "desc" }, take: 25 },
      _count: { select: { zipCodes: true, connectionEvents: true } },
    },
  });
  if (!utility) return err("Utility not found", 404);

  const successRate = await connectionSuccessRate(utility.id);

  return ok({ utility, successRate });
}

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const existing = await prisma.utilityTerritory.findUnique({ where: { id: params.id } });
  if (!existing) return err("Utility not found", 404);

  if (data.eiaid && data.eiaid !== existing.eiaid) {
    const dup = await prisma.utilityTerritory.findUnique({ where: { eiaid: data.eiaid } });
    if (dup) return err("A utility with this EIA ID already exists.", 409);
  }

  const utility = await prisma.utilityTerritory.update({ where: { id: params.id }, data });
  return ok({ utility, message: "Utility updated." });
}

export async function DELETE(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.utilityTerritory.findUnique({ where: { id: params.id } });
  if (!existing) return err("Utility not found", 404);

  const utility = await prisma.utilityTerritory.update({
    where: { id: params.id },
    data: { isActive: false },
  });
  return ok({ utility, message: "Utility disabled. It will no longer be matched for new signups; historical data is preserved." });
}

async function connectionSuccessRate(utilityId) {
  const [total, successes] = await Promise.all([
    prisma.utilityConnectionEvent.count({ where: { utilityId } }),
    prisma.utilityConnectionEvent.count({ where: { utilityId, success: true } }),
  ]);
  return { total, successes, rate: total ? Math.round((successes / total) * 100) : null };
}
