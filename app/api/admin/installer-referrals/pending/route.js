/**
 * GET /api/admin/installer-referrals/pending — every unverified,
 * self-reported installer referral claim, for admin review as a fallback
 * to homeowner self-confirmation.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const pending = await prisma.installerReferral.findMany({
    where: { verified: false },
    include: {
      installer: { select: { companyName: true } },
      user: { select: { name: true, email: true } },
    },
    orderBy: { referredAt: "desc" },
  });

  return ok({ pending });
}
