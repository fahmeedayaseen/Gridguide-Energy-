/**
 * PATCH  /api/enterprise/properties/[id] — update a property (Manager+)
 * DELETE /api/enterprise/properties/[id] — remove a property (Admin+ -
 *        more destructive than editing, so held to a higher bar)
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const updateSchema = z.object({
  name:             z.string().min(1).max(150).optional(),
  address:          z.string().optional(),
  type:             z.enum(["Residential","Commercial","Mixed-Use","HOA","Municipal","School/Institution"]).optional(),
  units:            z.union([z.string(), z.number()]).optional(),
  kw:               z.union([z.string(), z.number()]).optional(),
  status:           z.enum(["pending","active","inactive"]).optional(),
  utilityAccountId: z.string().nullable().optional(),
}).strict();

async function getOrgAndProperty(userId, propertyId, minRole) {
  const access = await requireEnterpriseRole(userId, minRole);
  if (!access.allowed) return { error: access.error, status: access.status };
  const property = await prisma.enterpriseProperty.findUnique({ where: { id: propertyId } });
  if (!property || property.orgId !== access.org.id) return { error: "Property not found", status: 404 };
  return { org: access.org, role: access.role, property };
}

export async function PATCH(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { org, role, property, error, status } = await getOrgAndProperty(auth.user.id, params.id, "Manager");
  if (error) return err(error, status);

  const { data, error: validationError } = await parseBody(request, updateSchema);
  if (validationError) return err("Validation failed", 400, validationError);

  const updateData = { ...data };
  if (updateData.units !== undefined) updateData.units = parseInt(updateData.units, 10) || 0;
  if (updateData.kw !== undefined) updateData.kw = parseFloat(updateData.kw) || 0;

  const updated = await prisma.enterpriseProperty.update({ where: { id: property.id }, data: updateData });

  await logAudit({
    actorUserId: auth.user.id, actorRole: role, action: "PROPERTY_UPDATED",
    targetType: "EnterpriseProperty", targetId: property.id, orgId: org.id,
    category: "ASSIGNMENT", metadata: { changes: data },
  });

  return ok({ property: updated, message: "Property updated." });
}

export async function DELETE(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { org, role, property, error, status } = await getOrgAndProperty(auth.user.id, params.id, "Admin");
  if (error) return err(error, status);

  await prisma.enterpriseProperty.delete({ where: { id: property.id } });

  await logAudit({
    actorUserId: auth.user.id, actorRole: role, action: "PROPERTY_REMOVED",
    targetType: "EnterpriseProperty", targetId: property.id, orgId: org.id,
    category: "ASSIGNMENT", metadata: { name: property.name },
  });

  return ok({ message: "Property removed." });
}
