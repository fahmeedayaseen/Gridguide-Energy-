/**
 * GET /api/admin/enterprise-installer-network — approval queue, only
 * rows where the installer has already consented (INSTALLER_ACCEPTED).
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const network = await prisma.enterpriseInstallerNetwork.findMany({
    where: status ? { status } : {},
    orderBy: { invitedAt: "desc" },
    include: { org: { select: { name: true } }, installer: { select: { companyName: true } } },
  });
  return ok({ network });
}
