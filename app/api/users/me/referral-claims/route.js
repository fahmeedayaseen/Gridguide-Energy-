/**
 * GET /api/users/me/referral-claims — this homeowner's pending, unverified
 * installer referral claims, awaiting their confirmation or rejection.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const claims = await prisma.installerReferral.findMany({
    where: { userId: auth.user.id, verified: false },
    include: { installer: { select: { companyName: true } } },
    orderBy: { referredAt: "desc" },
  });

  return ok({ claims });
}
