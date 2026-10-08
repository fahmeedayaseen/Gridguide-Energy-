/**
 * POST /api/vpp/events/partner/[id]/opt-out — homeowner skips one event
 * without leaving their program. Allowed until the event window starts.
 * Records OPTED_OUT on their VppEventParticipation row. Telling the partner
 * is NOT implemented (no partner contract yet), so the response says so.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function POST(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const event = await prisma.vppPartnerEvent.findUnique({ where: { id: params.id } });
  if (!event) return err("Event not found", 404);
  if (new Date(event.windowStart) <= new Date()) return err("This event has already started and can't be skipped.", 409);

  const enrollment = await prisma.vppProgramEnrollment.findFirst({
    where: {
      userId: auth.user.id, status: "ACTIVE",
      ...(event.programId ? { programId: event.programId } : { providerId: event.providerId }),
    },
  });
  if (!enrollment) return err("You're not enrolled in the program for this event.", 404);

  const participation = await prisma.vppEventParticipation.upsert({
    where:  { eventId_enrollmentId: { eventId: event.id, enrollmentId: enrollment.id } },
    update: { status: "OPTED_OUT" },
    create: { eventId: event.id, enrollmentId: enrollment.id, userId: auth.user.id, status: "OPTED_OUT" },
  });

  return ok({
    participation,
    partnerNotified: false,
    message: "You've skipped this event. Your program enrollment is unchanged.",
  });
}
