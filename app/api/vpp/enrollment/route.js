/**
 * GET   /api/vpp/enrollment   — get enrollment status
 * POST  /api/vpp/enrollment   — enroll / re-enroll
 * DELETE /api/vpp/enrollment  — opt out
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { legacyVppGateOrNull } from "@/lib/vpp-legacy-gate.js";
import { z } from "zod";

const optOutSchema = z.object({ reason: z.string().optional() });

// This is the legacy, program-wide VppEnrollment model (a single active/
// inactive flag, no provider/program/consent tracking). Superseded by
// /api/vpp/enrollments (plural), which is backed by VppProgramEnrollment.
// Gated behind ENABLE_LEGACY_VPP_DISPATCH — see lib/feature-flags.js.

export async function GET(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const enrollment = await prisma.vppEnrollment.findUnique({ where: { userId: auth.user.id } });
  const logs = await prisma.vppEnrollmentLog.findMany({
    where: { userId: auth.user.id }, orderBy: { createdAt: "desc" }, take: 10,
  });

  return ok({ enrolled: enrollment?.active ?? false, enrollment, logs });
}

export async function POST(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const enrollment = await prisma.vppEnrollment.upsert({
    where:  { userId: auth.user.id },
    create: { userId: auth.user.id, active: true },
    update: { active: true },
  });

  await prisma.vppEnrollmentLog.create({
    data: { userId: auth.user.id, action: "ENROLLED" },
  });

  return ok({ enrolled: true, enrollment, message: "Enrollment submitted. If your devices participate in an eligible event, any incentive is paid after the event settles." });
}

export async function DELETE(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data } = await parseBody(request, optOutSchema).catch(() => ({ data: {} }));

  const enrollment = await prisma.vppEnrollment.findUnique({ where: { userId: auth.user.id } });
  if (!enrollment?.active) return err("You are not currently enrolled in VPP.", 400);

  await prisma.vppEnrollment.update({ where: { userId: auth.user.id }, data: { active: false } });

  await prisma.vppEnrollmentLog.create({
    data: { userId: auth.user.id, action: "OPTED_OUT", reason: data?.reason || null },
  });

  return ok({ enrolled: false, message: "You have opted out of VPP. You can re-enroll at any time." });
}
