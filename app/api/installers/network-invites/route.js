/**
 * GET /api/installers/network-invites — this installer's enterprise
 * network relationships, all statuses.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer account not found.", 404);

  const invites = await prisma.enterpriseInstallerNetwork.findMany({
    where: { installerId: installer.id },
    orderBy: { invitedAt: "desc" },
    include: { org: { select: { name: true } } },
  });
  return ok({ invites });
}
