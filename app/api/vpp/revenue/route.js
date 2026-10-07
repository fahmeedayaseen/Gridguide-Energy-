import { prisma }       from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest, requireRole } from "@/lib/jwt.js";
import { settleVppParticipant } from "@/lib/vpp-settlement.js";
import { z }            from "zod";

const calcSchema = z.object({
  eventId:      z.string(),
  enrollmentId: z.string(),
  grossAmount:  z.number().nonnegative(),
  metadata:     z.any().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const where = auth.user.role === "ADMIN" ? {} : { userId: auth.user.id };
  const splits = await prisma.vppRevenueSplit.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { event: true, enrollment: { include: { program: true, provider: true } } } });
  const totals = splits.reduce((a, s) => ({ grossAmount: a.grossAmount + s.grossAmount, homeownerAmount: a.homeownerAmount + s.homeownerAmount, gridguideAmount: a.gridguideAmount + s.gridguideAmount, installerAmount: a.installerAmount + s.installerAmount }), { grossAmount: 0, homeownerAmount: 0, gridguideAmount: 0, installerAmount: 0 });
  return ok({ splits, totals });
}

/**
 * Settle one homeowner's single VPP event participation. For settling every
 * participant in an event at once from a partner's settlement file or
 * webhook, use POST /api/vpp/events/partner/[id]/settlement instead — this
 * endpoint remains for one-off admin corrections/recalculation.
 *
 * The actual split math, referral eligibility check, and wallet deposit
 * live in lib/vpp-settlement.js (settleVppParticipant) — shared with the
 * batch settlement path so there is exactly one implementation.
 */
export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, calcSchema);
  if (error) return err("Validation failed", 400, error);

  let settled;
  try {
    settled = await settleVppParticipant(prisma, data);
  } catch (e) {
    if (e.code === "VPP_ENROLLMENT_NOT_FOUND") return err("Enrollment not found", 404);
    throw e;
  }

  return ok({
    revenueSplit: settled.record,
    installerPlanApplied: settled.installerPlanApplied,
    splitPercentages: settled.splitPercentages,
    message: settled.alreadyDeposited
      ? "VPP revenue split recalculated (already deposited)."
      : "VPP revenue split calculated and cash deposited to wallet(s).",
  }, 201);
}
