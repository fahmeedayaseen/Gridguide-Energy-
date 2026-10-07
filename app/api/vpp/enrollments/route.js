import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { routeVppProgram, sendPartnerEnrollment } from "@/lib/vpp-partners.js";
import { z } from "zod";

const enrollSchema = z.object({
  programId: z.string().optional(),
  state: z.string().length(2).optional(),
  utility: z.string().optional(),
  deviceTypes: z.array(z.string()).optional(),
  deviceIds: z.array(z.string()).optional(),
  utilityAccountId: z.string().optional(),
  consentAccepted: z.boolean(),
  consentVersion: z.string().optional().default("vpp-consent-2026-06"),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const enrollments = await prisma.vppProgramEnrollment.findMany({ where: { userId: auth.user.id }, include: { provider: true, program: true, revenueSplits: true }, orderBy: { enrolledAt: "desc" } });
  return ok({ enrollments });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const { data, error } = await parseBody(request, enrollSchema);
  if (error) return err("Validation failed", 400, error);
  if (!data.consentAccepted) return err("Homeowner consent is required before VPP enrollment.", 400);

  const active = await prisma.vppProgramEnrollment.findFirst({ where: { userId: auth.user.id, status: { in: ["PENDING_PROVIDER", "ACTIVE"] } }, include: { program: true, provider: true } });
  if (active) return err("This homeowner is already enrolled or pending in a VPP program. Duplicate conflicting enrollment is blocked.", 409, { activeEnrollment: active });

  let program = data.programId ? await prisma.vppGridProgram.findUnique({ where: { id: data.programId }, include: { provider: true } }) : null;
  let routeReason = "Program selected by homeowner/admin.";
  if (!program) {
    const routed = await routeVppProgram({ prisma, userId: auth.user.id, state: data.state, utility: data.utility, deviceTypes: data.deviceTypes || [] });
    program = routed.recommended;
    routeReason = `Auto-routed by state=${data.state || "unknown"}, utility=${data.utility || "unknown"}, devices=${(data.deviceTypes || []).join(",") || "unknown"}.`;
  }
  if (!program) return err("No available VPP program found for this homeowner profile.", 404);

  let externalEnrollmentId = null;
  let status = "PENDING_PROVIDER";
  let syncError = null;
  try {
    const result = await sendPartnerEnrollment(program.provider.key, { userId: auth.user.id, programExternalId: program.externalProgramId, utilityAccountId: data.utilityAccountId, deviceIds: data.deviceIds || [], consentVersion: data.consentVersion });
    externalEnrollmentId = result.id || result.enrollmentId || null;
    status = result.status === "active" || result.status === "ACTIVE" ? "ACTIVE" : "PENDING_PROVIDER";
  } catch (e) {
    if (e.code === "VPP_PROVIDER_NOT_CONFIGURED") {
      syncError = e.message;
      status = "PENDING_PROVIDER";
    } else {
      throw e;
    }
  }

  const enrollment = await prisma.vppProgramEnrollment.create({ data: { userId: auth.user.id, providerId: program.providerId, programId: program.id, externalEnrollmentId, status, consentVersion: data.consentVersion, consentAcceptedAt: new Date(), utilityAccountId: data.utilityAccountId, deviceIds: data.deviceIds || [], routeReason, syncError } });
  return ok({ enrollment, provider: program.provider, program, message: syncError ? "Enrollment saved locally. Add partner API credentials to submit live enrollment." : "VPP enrollment submitted." }, 201);
}

const optOutSchema = z.object({ enrollmentId: z.string().optional(), reason: z.string().optional() });

/**
 * DELETE /api/vpp/enrollments — opt a homeowner out of their active/pending
 * VPP enrollment. This is the partner-based counterpart to the legacy
 * /api/vpp/enrollment (singular) opt-out, which is now gated off. Marks the
 * enrollment CANCELLED locally; it does not currently notify the partner
 * API of the cancellation (no partner cancel-enrollment call exists yet in
 * lib/vpp-partners.js) — flagged here rather than silently assumed done.
 */
export async function DELETE(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data } = await parseBody(request, optOutSchema).catch(() => ({ data: {} }));

  const enrollment = data?.enrollmentId
    ? await prisma.vppProgramEnrollment.findUnique({ where: { id: data.enrollmentId } })
    : await prisma.vppProgramEnrollment.findFirst({
        where: { userId: auth.user.id, status: { in: ["PENDING_CONSENT", "PENDING_PROVIDER", "ACTIVE"] } },
        orderBy: { enrolledAt: "desc" },
      });

  if (!enrollment || enrollment.userId !== auth.user.id) {
    return err("No active VPP enrollment found to opt out of.", 404);
  }

  const updated = await prisma.vppProgramEnrollment.update({
    where: { id: enrollment.id },
    data: { status: "CANCELLED", syncError: data?.reason ? `Opted out: ${data.reason}` : "Opted out by homeowner." },
  });

  return ok({ enrollment: updated, message: "You have opted out of this VPP program. You can re-enroll at any time." });
}
