/**
 * POST /api/vpp/events/[id]/dispatch
 *
 * Admin action: move a scheduled VPP event into ACTIVE dispatch. This is the
 * route the Admin Portal's "Dispatch" button calls (see VPPBatchEvents in the
 * frontend), which previously had no matching API route at all.
 *
 * This route only flips the event's own status and notifies currently
 * enrolled homeowners that dispatch has begun. It intentionally does NOT
 * compute or move money — that happens afterward via POST /api/vpp/payouts
 * once real per-participant kWh data is available (utility/aggregator
 * reporting, or partner webhook data for VppPartnerEvent-based programs).
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { legacyVppGateOrNull } from "@/lib/vpp-legacy-gate.js";

export async function POST(request, { params }) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { id } = params;

  const event = await prisma.vppEvent.findUnique({ where: { id } });
  if (!event) return err("VPP event not found", 404);

  if (event.status !== "SCHEDULED") {
    return err(
      `Cannot dispatch this event — it is currently ${event.status}. Only SCHEDULED events can be dispatched.`,
      409
    );
  }

  const updated = await prisma.vppEvent.update({
    where: { id },
    data: { status: "ACTIVE" },
  });

  // Notify currently enrolled, active homeowners that dispatch has begun.
  // VppEnrollment is program-wide (not per-event), so this reaches everyone
  // eligible to participate; actual participation/kWh is settled later via
  // the payouts step once real dispatch data comes back.
  const activeEnrollees = await prisma.vppEnrollment.findMany({
    where: { active: true },
    select: { userId: true },
  });

  if (activeEnrollees.length > 0) {
    await prisma.notification.createMany({
      data: activeEnrollees.map(({ userId }) => ({
        userId,
        type: "VPP_EVENT_DISPATCHED",
        title: "VPP Event Started",
        message: `${event.name} is now active (${event.program}). Your enrolled devices may be dispatched during this window.`,
        data: { eventId: event.id, windowStart: event.windowStart, windowEnd: event.windowEnd },
      })),
    }).catch((e) => {
      console.error("[VPP Dispatch] Notification batch failed:", e.message);
    });
  }

  return ok({
    event: updated,
    notifiedCount: activeEnrollees.length,
    message: "Event dispatched. Enrolled homeowners have been notified.",
  });
}
