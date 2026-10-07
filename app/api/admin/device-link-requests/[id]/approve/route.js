/**
 * POST /api/admin/device-link-requests/[id]/approve — platform-admin
 * override for the homeowner consent flow (e.g. a support case where the
 * homeowner has verbally agreed but hasn't clicked through the in-app
 * flow). Requires the same deviceId confirmation a homeowner would give.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const approveSchema = z.object({ deviceId: z.string() });

export async function POST(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const linkRequest = await prisma.enterpriseDeviceLinkRequest.findUnique({ where: { id: params.id } });
  if (!linkRequest) return err("Request not found", 404);
  if (linkRequest.status !== "PENDING") return err("This request has already been resolved.", 409);

  const { data, error } = await parseBody(request, approveSchema);
  if (error) return err("Validation failed", 400, error);

  const device = await prisma.device.findUnique({ where: { id: data.deviceId } });
  if (!device) return err("Device not found.", 404);
  if (linkRequest.homeownerUserId && device.userId !== linkRequest.homeownerUserId) {
    return err("This device does not belong to the homeowner named on this request.", 400);
  }
  if (device.enterprisePropertyId) return err("This device is already linked to a property.", 409);

  const [updatedRequest] = await prisma.$transaction([
    prisma.enterpriseDeviceLinkRequest.update({
      where: { id: linkRequest.id },
      data: { status: "APPROVED", deviceId: device.id, resolvedByUserId: auth.user.id, resolvedByRole: "PLATFORM_ADMIN", resolvedAt: new Date() },
    }),
    prisma.device.update({ where: { id: device.id }, data: { enterprisePropertyId: linkRequest.propertyId } }),
  ]);

  await prisma.enterpriseAuditLog.create({
    data: { orgId: linkRequest.orgId, userId: auth.user.id, action: "DEVICE_LINK_ADMIN_APPROVED", metadata: { requestId: linkRequest.id, deviceId: device.id } },
  }).catch(() => {});

  return ok({ request: updatedRequest, message: "Device linked via admin override." });
}
