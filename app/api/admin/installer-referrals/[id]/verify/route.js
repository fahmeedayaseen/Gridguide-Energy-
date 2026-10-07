/**
 * POST /api/admin/installer-referrals/[id]/verify — admin approves or
 * rejects a self-reported referral claim, as a fallback to homeowner
 * self-confirmation (e.g. the homeowner never responds).
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const schema = z.object({ decision: z.enum(["approve", "reject"]) });

export async function POST(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const claim = await prisma.installerReferral.findUnique({ where: { id: params.id } });
  if (!claim) return err("Referral claim not found.", 404);
  if (claim.verified) return err("This referral is already verified.", 409);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  if (data.decision === "reject") {
    await prisma.installerReferral.delete({ where: { id: claim.id } });
    await prisma.installer.update({
      where: { id: claim.installerId },
      data: { totalReferredUsers: { decrement: 1 } },
    }).catch(() => {});

    await logAudit({
      actorUserId: auth.user.id, actorRole: "ADMIN", action: "REFERRAL_CLAIM_ADMIN_REJECTED",
      targetType: "InstallerReferral", targetId: claim.id,
      category: "REFERRAL", metadata: { installerId: claim.installerId, userId: claim.userId },
    });

    return ok({ message: "Referral claim rejected and removed." });
  }

  const updated = await prisma.installerReferral.update({
    where: { id: claim.id },
    data: { verified: true, verifiedAt: new Date(), verifiedByUserId: auth.user.id },
  });

  await logAudit({
    actorUserId: auth.user.id, actorRole: "ADMIN", action: "REFERRAL_CLAIM_ADMIN_APPROVED",
    targetType: "InstallerReferral", targetId: claim.id,
    category: "REFERRAL", metadata: { installerId: claim.installerId, userId: claim.userId },
  });

  return ok({ referral: updated, message: "Referral approved." });
}
