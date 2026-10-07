/**
 * GET /api/users/me/sponsorship — the transparency measure for Phase 3:
 * lets the homeowner dashboard show an honest "your plan is sponsored by
 * X" notice rather than silently changing their effective plan.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const sponsorship = await prisma.enterpriseSponsorship.findUnique({
    where: { userId: auth.user.id },
    include: { org: { select: { name: true } } },
  });

  if (!sponsorship || sponsorship.status !== "ACTIVE") return ok({ sponsorship: null });
  return ok({ sponsorship: { orgName: sponsorship.org.name, plan: sponsorship.plan } });
}
