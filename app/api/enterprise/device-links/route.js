/**
 * GET /api/enterprise/device-links — this org's device link requests, all statuses.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  const requests = await prisma.enterpriseDeviceLinkRequest.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: "desc" },
    include: { property: { select: { name: true } } },
  });

  const deviceIds = requests.map((r) => r.deviceId).filter(Boolean);
  const devices = deviceIds.length
    ? await prisma.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true, type: true } })
    : [];
  const deviceById = Object.fromEntries(devices.map((d) => [d.id, d]));

  return ok({ requests: requests.map((r) => ({ ...r, device: r.deviceId ? deviceById[r.deviceId] : null })) });
}
