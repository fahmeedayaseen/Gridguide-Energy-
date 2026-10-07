import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest, requireRole } from "@/lib/jwt.js";
import { assertFeature } from "@/lib/memberships.js";
import { getEffectivePlanForUser } from "@/lib/effective-plan.js";
import { legacyVppGateOrNull } from "@/lib/vpp-legacy-gate.js";

// Legacy — VppEnrollment-based (program-wide active/inactive flag, no
// provider/program tracking). Superseded by /api/vpp/enrollments (plural),
// which is backed by VppProgramEnrollment and routes to a real partner.
// Gated behind ENABLE_LEGACY_VPP_DISPATCH.

// GET /api/vpp/participants — admin: list enrolled homeowners
export async function GET(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId");

  const where = eventId
    ? { payouts: { some: { eventId } } }
    : {};

  const enrollments = await prisma.vppEnrollment.findMany({
    where,
    include: {
      user:    { select: { id: true, name: true, email: true } },
      devices: { select: { type: true, manufacturer: true, model: true } },
    },
    orderBy: { enrolledAt: "desc" },
  });

  return ok({ enrollments, total: enrollments.length });
}

// POST /api/vpp/participants/enroll — homeowner enrolls in VPP
export async function POST(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const user = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { plan: true } });
  const effectivePlan = await getEffectivePlanForUser(auth.user.id);
  const featureCheck = assertFeature(effectivePlan || user?.plan, "vppParticipation", "VPP participation");
  if (!featureCheck.allowed) return err(featureCheck.error, featureCheck.status, featureCheck);

  const existing = await prisma.vppEnrollment.findUnique({ where: { userId: auth.user.id } });
  if (existing) {
    // Re-activate if previously inactive
    if (!existing.active) {
      await prisma.vppEnrollment.update({ where: { userId: auth.user.id }, data: { active: true } });
      return ok({ message: "VPP enrollment re-activated." });
    }
    return err("You are already enrolled in VPP.", 409);
  }

  // Check user has at least one battery device
  const battery = await prisma.device.findFirst({
    where: { userId: auth.user.id, type: "BATTERY", status: "ACTIVE" },
  });
  if (!battery) {
    return err("A connected battery device is required to enroll in VPP.", 400);
  }

  const enrollment = await prisma.vppEnrollment.create({
    data: { userId: auth.user.id, active: true },
  });

  await prisma.notification.create({
    data: {
      userId:  auth.user.id,
      type:    "VPP_ENROLLED",
      title:   "VPP Enrollment Active",
      message: "You're enrolled in GridGuide VPP. Your devices are eligible for the connected demand response program — GridGuide's share of VPP earnings depends on your plan and referral tier (typically 15–20%).",
    },
  });

  return ok({ enrollment, message: "Successfully enrolled in VPP." }, 201);
}

// DELETE /api/vpp/participants — homeowner leaves VPP
export async function DELETE(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  await prisma.vppEnrollment.update({
    where: { userId: auth.user.id },
    data:  { active: false },
  });

  return ok({ message: "VPP enrollment paused. You can re-enroll at any time." });
}
