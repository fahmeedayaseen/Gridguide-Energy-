/**
 * POST /api/users/me/device-link-requests/[id]/respond
 * body: { action: "approve"|"reject", deviceId? } (deviceId required to approve)
 *
 * This is the ONLY place Device.enterprisePropertyId gets set from the
 * homeowner side — an enterprise admin can request a link, but only the
 * homeowner (or a platform admin, via the separate admin override route)
 * can actually make it real.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const respondSchema = z.object({
  action: z.enum(["approve", "reject"]),
  deviceId: z.string().optional(),
}).refine((d) => d.action !== "approve" || !!d.deviceId, { message: "deviceId is required to approve a link request." });

export async function POST(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const linkRequest = await prisma.enterpriseDeviceLinkRequest.findUnique({ where: { id: params.id } });
  if (!linkRequest) return err("Request not found", 404);
  if (linkRequest.homeownerUserId !== auth.user.id) return err("Unauthorized", 403);
  if (linkRequest.status !== "PENDING") return err("This request has already been resolved.", 409);

  const { data, error } = await parseBody(request, respondSchema);
  if (error) return err(error.errors?.[0]?.message || "Validation failed", 400, error);

  if (data.action === "reject") {
    const updated = await prisma.enterpriseDeviceLinkRequest.update({
      where: { id: linkRequest.id },
      data: { status: "REJECTED", resolvedByUserId: auth.user.id, resolvedByRole: "HOMEOWNER", resolvedAt: new Date() },
    });
    return ok({ request: updated, message: "Request declined." });
  }

  // Approve — verify the device really belongs to this user and isn't
  // already linked elsewhere.
  const device = await prisma.device.findUnique({ where: { id: data.deviceId } });
  if (!device || device.userId !== auth.user.id) return err("Device not found on your account.", 404);
  if (device.enterprisePropertyId) return err("This device is already linked to a property.", 409);

  const [updatedRequest] = await prisma.$transaction([
    prisma.enterpriseDeviceLinkRequest.update({
      where: { id: linkRequest.id },
      data: { status: "APPROVED", deviceId: device.id, resolvedByUserId: auth.user.id, resolvedByRole: "HOMEOWNER", resolvedAt: new Date() },
    }),
    prisma.device.update({ where: { id: device.id }, data: { enterprisePropertyId: linkRequest.propertyId } }),
  ]);

  await prisma.enterpriseAuditLog.create({
    data: { orgId: linkRequest.orgId, userId: auth.user.id, action: "DEVICE_LINK_APPROVED", metadata: { requestId: linkRequest.id, deviceId: device.id } },
  }).catch(() => {});

  return ok({ request: updatedRequest, message: "Device linked." });
}
