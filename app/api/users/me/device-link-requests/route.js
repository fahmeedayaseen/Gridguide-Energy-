/**
 * GET /api/users/me/device-link-requests — pending requests from enterprise
 * orgs asking to link one of the current user's devices to their property.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const requests = await prisma.enterpriseDeviceLinkRequest.findMany({
    where: { homeownerUserId: auth.user.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: {
      org: { select: { name: true } },
      property: { select: { name: true, address: true } },
    },
  });

  // Only show devices not already linked elsewhere — nothing to choose
  // from means the homeowner can still explicitly reject the request.
  const eligibleDevices = await prisma.device.findMany({
    where: { userId: auth.user.id, enterprisePropertyId: null },
    select: { id: true, name: true, type: true, brand: true },
  });

  return ok({ requests, eligibleDevices });
}
