/**
 * POST /api/enterprise/properties/[id]/link-device — an enterprise admin
 * requests linking a homeowner's existing device to this property.
 *
 * This does NOT set Device.enterprisePropertyId directly — it only creates
 * a PENDING EnterpriseDeviceLinkRequest and notifies the homeowner. The
 * link only becomes real once the homeowner approves (picking which
 * device) or a platform admin approves on their behalf. See
 * app/api/users/me/device-link-requests and
 * app/api/admin/device-link-requests for the approval side.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const requestSchema = z.object({ homeownerEmail: z.string().email() });

export async function POST(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  const property = await prisma.enterpriseProperty.findUnique({ where: { id: params.id } });
  if (!property || property.orgId !== org.id) return err("Property not found", 404);

  const { data, error } = await parseBody(request, requestSchema);
  if (error) return err("Validation failed", 400, error);

  const homeowner = await prisma.user.findUnique({ where: { email: data.homeownerEmail } });
  if (!homeowner) return err("No GridGuide account found with that email.", 404);

  // Avoid duplicate pending requests for the same homeowner + property.
  const existing = await prisma.enterpriseDeviceLinkRequest.findFirst({
    where: { propertyId: property.id, homeownerEmail: data.homeownerEmail, status: "PENDING" },
  });
  if (existing) return err("A request for this homeowner and property is already pending.", 409);

  const linkRequest = await prisma.enterpriseDeviceLinkRequest.create({
    data: {
      orgId: org.id, propertyId: property.id,
      homeownerEmail: data.homeownerEmail, homeownerUserId: homeowner.id,
      requestedByUserId: auth.user.id, status: "PENDING",
    },
  });

  await prisma.notification.create({
    data: {
      userId: homeowner.id, type: "ENTERPRISE_DEVICE_LINK_REQUEST",
      title: "Property manager requesting device link",
      message: `${org.name} would like to link one of your devices to "${property.name}". Review and choose which device, if any, to share.`,
      data: { requestId: linkRequest.id, orgName: org.name, propertyName: property.name },
    },
  }).catch(() => {});

  await logAudit({
    actorUserId: auth.user.id, actorRole: access.role, action: "DEVICE_LINK_REQUESTED",
    targetType: "EnterpriseDeviceLinkRequest", targetId: linkRequest.id, orgId: org.id,
    category: "ASSIGNMENT", metadata: { homeownerEmail: data.homeownerEmail, propertyId: property.id },
  });

  return ok({ request: linkRequest, message: `Request sent to ${data.homeownerEmail}. The device will link once they approve.` }, 201);
}
