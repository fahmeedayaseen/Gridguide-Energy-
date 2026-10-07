import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { calculateGridGuideFee } from "@/lib/enterprise.js";
import { legacyVppGateOrNull } from "@/lib/vpp-legacy-gate.js";
import { z } from "zod";

// Legacy — a third, separate VPP-event modeling (VppOperation/VppProgram),
// where an admin manually enters estimated/actual revenue and GridGuide
// computes its own fee, implying GridGuide operates the event. Superseded
// by the partner-based system (VppProvider/VppGridProgram/VppPartnerEvent).
// Gated behind ENABLE_LEGACY_VPP_DISPATCH.

const operationSchema = z.object({
  programId: z.string().optional(),
  eventId: z.string().optional(),
  name: z.string().min(2),
  operationType: z.enum(["DEMAND_RESPONSE", "BATTERY_DISPATCH", "EV_CHARGING_SHIFT", "THERMOSTAT_PRECOOL", "LOAD_REDUCTION"]).optional().default("DEMAND_RESPONSE"),
  status: z.enum(["PLANNED", "ENROLLING", "ACTIVE", "VERIFYING", "SETTLED", "CANCELLED"]).optional().default("PLANNED"),
  targetKw: z.number().optional(),
  committedKw: z.number().optional(),
  deliveredKwh: z.number().optional(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  participantCount: z.number().int().min(0).optional(),
  estimatedRevenue: z.number().min(0).optional().default(0),
  actualRevenue: z.number().min(0).optional().default(0),
  feePct: z.number().min(0).max(1).optional().default(0.20), // legacy default — current system uses lib/platform-config.js getVppSplit's plan-tier splits (15-20%) instead of a single flat rate
  notes: z.string().optional(),
  metadata: z.any().optional(),
});

function requireAdmin(auth) {
  return auth.user?.role === "ADMIN" ? null : err("Admin access required", 403);
}

export async function GET(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  const operations = await prisma.vppOperation.findMany({
    where: status ? { status } : {},
    include: { program: true },
    orderBy: { windowStart: "desc" },
    take: 100,
  });
  return ok({ operations });
}

export async function POST(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const adminError = requireAdmin(auth);
  if (adminError) return adminError;
  const { data, error } = await parseBody(request, operationSchema);
  if (error) return err("Validation failed", 400, error);

  const revenue = calculateGridGuideFee(data.actualRevenue || data.estimatedRevenue || 0, data.feePct);
  const operation = await prisma.vppOperation.create({
    data: {
      programId: data.programId,
      eventId: data.eventId,
      name: data.name,
      operationType: data.operationType,
      status: data.status,
      targetKw: data.targetKw,
      committedKw: data.committedKw,
      deliveredKwh: data.deliveredKwh,
      windowStart: new Date(data.windowStart),
      windowEnd: new Date(data.windowEnd),
      participantCount: data.participantCount || 0,
      estimatedRevenue: data.estimatedRevenue || 0,
      actualRevenue: data.actualRevenue || 0,
      gridguideFee: revenue.gridguideFee,
      notes: data.notes,
      metadata: data.metadata,
    },
  });
  return ok({ operation, message: "VPP operation created." }, 201);
}
