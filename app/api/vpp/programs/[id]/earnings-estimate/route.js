/**
 * Admin-published, source-verified earnings estimates for a VPP program.
 *   GET  /api/vpp/programs/[id]/earnings-estimate — list (admin)
 *   POST /api/vpp/programs/[id]/earnings-estimate — publish (admin)
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const estimateSchema = z.object({
  lowAmount:      z.number().min(0).max(100000),
  highAmount:     z.number().min(0).max(100000),
  period:         z.enum(["per_event", "per_month", "per_season", "per_year"]),
  deviceType:     z.enum(["BATTERY", "EV_CHARGER", "THERMOSTAT", "SOLAR_INVERTER"]).optional(),
  sourceVerified: z.literal(true, { errorMap: () => ({ message: "Only source-verified estimates can be published." }) }),
  sourceName:     z.string().min(3).max(200),
  sourceUrl:      z.string().url().optional(),
  notes:          z.string().max(2000).optional(),
  validFrom:      z.string().datetime().optional(),
  validTo:        z.string().datetime().optional(),
}).strict()
  .refine((d) => d.highAmount >= d.lowAmount, { message: "highAmount must be ≥ lowAmount", path: ["highAmount"] })
  .refine((d) => !d.validTo || !d.validFrom || new Date(d.validTo) > new Date(d.validFrom), { message: "validTo must be after validFrom", path: ["validTo"] });

export async function GET(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const estimates = await prisma.vppProgramEarningsEstimate.findMany({ where: { programId: params.id }, orderBy: { validFrom: "desc" } });
  return ok({ estimates });
}

export async function POST(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const program = await prisma.vppGridProgram.findUnique({ where: { id: params.id }, select: { id: true, name: true } });
  if (!program) return err("VPP program not found", 404);

  const { data, error } = await parseBody(request, estimateSchema);
  if (error) return err("Validation failed", 400, error);

  const estimate = await prisma.vppProgramEarningsEstimate.create({
    data: {
      programId: program.id, lowAmount: data.lowAmount, highAmount: data.highAmount, period: data.period,
      deviceType: data.deviceType, sourceVerified: true, sourceName: data.sourceName, sourceUrl: data.sourceUrl,
      notes: data.notes, validFrom: data.validFrom ? new Date(data.validFrom) : new Date(),
      validTo: data.validTo ? new Date(data.validTo) : null, publishedById: auth.user.id,
    },
  });

  await prisma.platformAuditLog.create({
    data: { actorUserId: auth.user.id, actorRole: "ADMIN", action: "VPP_EARNINGS_ESTIMATE_PUBLISHED",
            targetType: "VppGridProgram", targetId: program.id, category: "VPP",
            metadata: { estimateId: estimate.id, low: data.lowAmount, high: data.highAmount, period: data.period, source: data.sourceName } },
  }).catch(() => {});

  return ok({ estimate }, 201);
}
