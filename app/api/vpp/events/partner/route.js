import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest, requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const eventSchema = z.object({
  providerKey: z.string().min(2).transform(v => v.toLowerCase()),
  programId: z.string().optional(),
  externalEventId: z.string().optional(),
  name: z.string().min(2),
  eventType: z.enum(["DEMAND_RESPONSE","BATTERY_DISPATCH","THERMOSTAT_CONTROL","EV_CHARGING_MANAGEMENT","SOLAR_EXPORT"]).optional(),
  market: z.string().optional(),
  utility: z.string().optional(),
  state: z.string().length(2).optional().transform(v => v?.toUpperCase()),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  targetKw: z.number().optional(),
  grossRevenue: z.number().optional(),
  metadata: z.any().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  const scope = searchParams.get("scope") || undefined; // "admin" — see below

  // Admin view: list partner events across ALL providers/programs, past and
  // upcoming, for platform-wide oversight (e.g. the Admin VPP screen). Only
  // available to ADMIN users — a non-admin passing scope=admin is silently
  // treated as the homeowner-scoped view below instead of erroring, since
  // this is a read scope, not a privileged action.
  if (scope === "admin" && auth.user.role === "ADMIN") {
    const events = await prisma.vppPartnerEvent.findMany({
      where: status ? { status } : undefined,
      orderBy: { windowStart: "desc" },
      include: { provider: true, program: true, _count: { select: { participations: true, revenueSplits: true } } },
      take: 200,
    });
    return ok({ events, scope: "admin" });
  }

  const now = new Date();
  const enrollments = await prisma.vppProgramEnrollment.findMany({ where: { userId: auth.user.id, status: { in: ["ACTIVE","PENDING_PROVIDER"] } }, select: { programId: true, providerId: true } });
  const programIds = enrollments.map(e => e.programId);
  const providerIds = enrollments.map(e => e.providerId);
  // An event tied to a program is shown only to that program's enrollees.
  // Provider-wide events (no programId) go to anyone enrolled with that
  // provider. Previously any event from the same provider matched, so a
  // Program B event appeared for Program A enrollees.
  const events = await prisma.vppPartnerEvent.findMany({
    where: { ...(status && { status }), OR: [{ programId: { in: programIds } }, { programId: null, providerId: { in: providerIds } }], windowEnd: { gte: now } },
    orderBy: { windowStart: "asc" },
    include: { provider: true, program: true },
    take: 50,
  });
  return ok({ events, scope: "homeowner" });
}

export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const { data, error } = await parseBody(request, eventSchema);
  if (error) return err("Validation failed", 400, error);
  const provider = await prisma.vppProvider.findUnique({ where: { key: data.providerKey } });
  if (!provider) return err("VPP provider not found", 404);
  const event = await prisma.vppPartnerEvent.create({ data: {
    providerId: provider.id, programId: data.programId, externalEventId: data.externalEventId, name: data.name,
    eventType: data.eventType || "DEMAND_RESPONSE", market: data.market, utility: data.utility, state: data.state,
    windowStart: new Date(data.windowStart), windowEnd: new Date(data.windowEnd), targetKw: data.targetKw, grossRevenue: data.grossRevenue || 0, metadata: data.metadata,
  }});
  // Invite every active enrollee of the event's program. VppEventParticipation
  // existed in the schema but was never created anywhere, so per-home
  // participation, opt-outs and performance had nowhere to live.
  let invited = 0;
  if (event.programId) {
    const enrollees = await prisma.vppProgramEnrollment.findMany({
      where: { programId: event.programId, status: "ACTIVE" },
      select: { id: true, userId: true },
    });
    if (enrollees.length) {
      const res = await prisma.vppEventParticipation.createMany({
        data: enrollees.map(e => ({ eventId: event.id, enrollmentId: e.id, userId: e.userId, status: "INVITED" })),
        skipDuplicates: true,
      });
      invited = res.count;
    }
  }
  return ok({ event, invited, message: `Partner VPP event created.${invited ? ` ${invited} enrolled home(s) invited.` : ""}` }, 201);
}
