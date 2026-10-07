import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest, requireRole } from "@/lib/jwt.js";
import { routeVppProgram } from "@/lib/vpp-partners.js";
import { z } from "zod";

const programSchema = z.object({
  providerKey: z.string().min(2).transform(v => v.toLowerCase()),
  externalProgramId: z.string().optional(),
  name: z.string().min(2),
  market: z.string().optional(),
  state: z.string().length(2).optional().transform(v => v?.toUpperCase()),
  utility: z.string().optional(),
  programType: z.enum(["DEMAND_RESPONSE","BATTERY_DISPATCH","THERMOSTAT_CONTROL","EV_CHARGING_MANAGEMENT","SOLAR_EXPORT"]).optional(),
  deviceTypes: z.array(z.string()).optional(),
  status: z.enum(["ACTIVE","WAITLIST","PAUSED","CLOSED"]).optional(),
  rules: z.any().optional(),
  estimatedRateKwh: z.number().optional(),
  estimatedRateKw: z.number().optional(),
  gridguideFeePct: z.number().min(0).max(1).optional(),
  installerSharePct: z.number().min(0).max(1).optional(),
  homeownerSharePct: z.number().min(0).max(1).optional(),
  conflictGroup: z.string().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state") || undefined;
  const utility = searchParams.get("utility") || undefined;
  const deviceTypes = (searchParams.get("deviceTypes") || "").split(",").filter(Boolean);
  const routed = await routeVppProgram({ prisma, userId: auth.user.id, state, utility, deviceTypes });
  return ok({ programs: routed.eligible, recommended: routed.recommended, activeEnrollment: routed.activeEnrollment, conflict: routed.conflict });
}

export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const { data, error } = await parseBody(request, programSchema);
  if (error) return err("Validation failed", 400, error);
  const provider = await prisma.vppProvider.findUnique({ where: { key: data.providerKey } });
  if (!provider) return err("VPP provider not found. Create the provider first.", 404);
  const program = await prisma.vppGridProgram.create({ data: {
    providerId: provider.id, externalProgramId: data.externalProgramId, name: data.name, market: data.market,
    state: data.state, utility: data.utility, programType: data.programType || "DEMAND_RESPONSE", deviceTypes: data.deviceTypes || [],
    status: data.status || "ACTIVE", rules: data.rules, estimatedRateKwh: data.estimatedRateKwh, estimatedRateKw: data.estimatedRateKw,
    gridguideFeePct: data.gridguideFeePct ?? 0.10, installerSharePct: data.installerSharePct ?? 0, homeownerSharePct: data.homeownerSharePct ?? 0.90,
    conflictGroup: data.conflictGroup,
  }});
  return ok({ program, message: "VPP program created." }, 201);
}
