/**
 * POST /api/users/me/referral-claims/[id]/respond — a homeowner confirms
 * or rejects an installer's claim that they're one of their customers.
 * Confirming is what actually allows this referral to ever earn the
 * installer real commission or VPP revenue share (see verified: true
 * gate in payments/webhook/route.js and lib/vpp-revenue-rules.js).
 * Rejecting removes the claim entirely.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const schema = z.object({ action: z.enum(["confirm", "reject"]) });

export async function POST(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const claim = await prisma.installerReferral.findUnique({
    where: { id: params.id },
    include: { installer: { select: { companyName: true, userId: true } } },
  });
  if (!claim || claim.userId !== auth.user.id) return err("Referral claim not found.", 404);
  if (claim.verified) return err("This referral has already been confirmed.", 409);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  if (data.action === "reject") {
    await prisma.installerReferral.delete({ where: { id: claim.id } });
    await prisma.installer.update({
      where: { id: claim.installerId },
      data: { totalReferredUsers: { decrement: 1 } },
    }).catch(() => {});

    await logAudit({
      actorUserId: auth.user.id, actorRole: "CONSUMER", action: "REFERRAL_CLAIM_REJECTED",
      targetType: "InstallerReferral", targetId: claim.id,
      category: "REFERRAL", metadata: { installerId: claim.installerId },
    });

    return ok({ message: "Referral claim rejected and removed." });
  }

  const updated = await prisma.installerReferral.update({
    where: { id: claim.id },
    data: { verified: true, verifiedAt: new Date(), verifiedByUserId: auth.user.id },
  });

  await prisma.notification.create({
    data: {
      userId: claim.installer.userId, type: "REFERRAL_CLAIM_CONFIRMED",
      title: "Referral confirmed", message: "A homeowner confirmed your referral claim.",
    },
  }).catch(() => {});

  await logAudit({
    actorUserId: auth.user.id, actorRole: "CONSUMER", action: "REFERRAL_CLAIM_CONFIRMED",
    targetType: "InstallerReferral", targetId: claim.id,
    category: "REFERRAL", metadata: { installerId: claim.installerId },
  });

  return ok({ referral: updated, message: "Referral confirmed." });
}
