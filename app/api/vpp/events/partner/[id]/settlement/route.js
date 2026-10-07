import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { settleVppEventBatch, recomputeEventGrossRevenue } from "@/lib/vpp-settlement.js";
import { z } from "zod";

const participantSchema = z.object({
  enrollmentId: z.string().optional(),
  externalEnrollmentId: z.string().optional(),
  userId: z.string().optional(),
  grossAmount: z.number().positive(),
  deliveredKwh: z.number().optional(),
}).refine(p => p.enrollmentId || p.externalEnrollmentId || p.userId, {
  message: "Each participant needs one of enrollmentId, externalEnrollmentId, or userId",
});

const settlementSchema = z.object({
  participants: z.array(participantSchema).min(1),
  markSettled: z.boolean().optional().default(true),
  metadata: z.any().optional(),
});

/**
 * POST /api/vpp/events/partner/[id]/settlement — admin: import a partner's
 * settlement data for an event and settle every participant at once.
 *
 * This is how GridGuide accepts settlement data from Leap, Enel, or another
 * partner — either pasted/uploaded by an admin from the partner's settlement
 * report, or (see the "settlement.reported" case in
 * app/api/vpp/webhooks/[provider]/route.js) submitted automatically when a
 * partner's webhook delivers per-participant settlement data directly.
 *
 * Each participant is resolved to a VppProgramEnrollment by enrollmentId,
 * externalEnrollmentId (the partner's own reference — what a real partner
 * settlement file will actually contain), or userId (convenience for
 * admin-typed corrections). Per-participant failures (unresolvable
 * enrollment, bad amount) don't abort the batch — the response reports
 * exactly which rows succeeded and which failed, and why.
 *
 * Idempotent per participant: re-importing the same event's settlement
 * (e.g. a corrected file) recalculates splits but never double-deposits
 * cash — see lib/vpp-settlement.js.
 */
export async function POST(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const event = await prisma.vppPartnerEvent.findUnique({ where: { id: params.id } });
  if (!event) return err("VPP partner event not found", 404);

  const { data, error } = await parseBody(request, settlementSchema);
  if (error) return err("Validation failed", 400, error);

  const batch = await settleVppEventBatch(prisma, {
    eventId: event.id,
    participants: data.participants,
    metadata: data.metadata,
  });

  if (data.markSettled && batch.successCount > 0) {
    await recomputeEventGrossRevenue(prisma, event.id);
    await prisma.vppPartnerEvent.update({
      where: { id: event.id },
      data: {
        status: (batch.failCount === 0 && batch.depositFailedCount === 0) ? "SETTLED" : "SETTLEMENT_PENDING",
      },
    }).catch(e => console.error("[VPP Batch Settlement] Event status update failed:", e.message));
  }

  return ok({
    eventId: event.id,
    successCount: batch.successCount,
    failCount: batch.failCount,
    depositFailedCount: batch.depositFailedCount,
    totals: batch.totals,
    results: batch.results.map(r => r.ok
      ? { ok: true, enrollmentId: r.enrollmentId, split: r.record, alreadyDeposited: r.alreadyDeposited, depositFailed: r.depositFailed, depositError: r.depositError }
      : { ok: false, input: r.input, error: r.error, code: r.code }),
    message: (batch.failCount === 0 && batch.depositFailedCount === 0)
      ? `Settled ${batch.successCount} participant(s). Cash deposited to homeowner and eligible installer wallets.`
      : `${batch.successCount - batch.depositFailedCount} of ${batch.successCount + batch.failCount} participant(s) fully settled. ` +
        `${batch.failCount > 0 ? `${batch.failCount} row(s) couldn't be resolved. ` : ""}` +
        `${batch.depositFailedCount > 0 ? `${batch.depositFailedCount} row(s) were recorded but the wallet deposit failed — safe to retry by re-importing.` : ""}`,
  }, (batch.failCount === 0 && batch.depositFailedCount === 0) ? 201 : 207); // 207 Multi-Status when anything needs review
}
