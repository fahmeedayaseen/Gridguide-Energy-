import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest, requireRole } from "@/lib/jwt.js";
import { legacyVppGateOrNull } from "@/lib/vpp-legacy-gate.js";
import { z } from "zod";

// This is the legacy VppEvent model, where an admin manually enters a
// utility payment amount and GridGuide computes/holds a platform fee as if
// it were the party being paid by the utility and operating the event.
// Superseded by GET/POST /api/vpp/events/partner (VppPartnerEvent), which
// reflects events as reported by a VPP partner (Leap, Enel, etc.) via their
// API or webhook. Gated behind ENABLE_LEGACY_VPP_DISPATCH.
const VPP_FEE_RATE = 0.20; // Legacy fixed fee rate — updated to match the current partner-based system's default GridGuide share (see lib/platform-config.js getVppSplit). Only reachable when ENABLE_LEGACY_VPP_DISPATCH=true.

const createEventSchema = z.object({
  name:          z.string(),
  program:       z.string(),
  utility:       z.string(),
  windowStart:   z.string().datetime(),
  windowEnd:     z.string().datetime(),
  utilityPayment: z.number().positive(),
});

// GET /api/vpp/events — list upcoming and past events
export async function GET(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // scheduled|active|completed|paid

  const events = await prisma.vppEvent.findMany({
    where: status ? { status } : undefined,
    orderBy: { windowStart: "desc" },
    include: {
      _count: { select: { payouts: true } },
    },
  });

  // For each event, show user's payout if they participated
  const userPayouts = auth.user ? await prisma.vppPayout.findMany({
    where: {
      userId:  auth.user.id,
      eventId: { in: events.map((e) => e.id) },
    },
  }) : [];

  const eventsWithPayouts = events.map((event) => ({
    ...event,
    participantCount: event._count.payouts,
    userPayout: userPayouts.find((p) => p.eventId === event.id) || null,
  }));

  return ok({ events: eventsWithPayouts });
}

// POST /api/vpp/events — admin creates VPP event
export async function POST(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, createEventSchema);
  if (error) return err("Validation failed", 400, error);

  const gridguideFee = data.utilityPayment * VPP_FEE_RATE;
  const netPool = data.utilityPayment - gridguideFee;

  const event = await prisma.vppEvent.create({
    data: {
      ...data,
      windowStart:    new Date(data.windowStart),
      windowEnd:      new Date(data.windowEnd),
      gridguideFee,
      netPool,
      status:         "SCHEDULED",
    },
  });

  return ok({ event }, 201);
}
