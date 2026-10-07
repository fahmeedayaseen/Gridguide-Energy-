import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { checkPropertyLimit, requireOrganizationRole } from "@/lib/enterprise.js";
import { z } from "zod";

const propertySchema = z.object({
  organizationId: z.string().optional(),
  name: z.string().min(1).max(120),
  propertyType: z.enum(["SINGLE_FAMILY", "MULTI_FAMILY", "COMMERCIAL", "INDUSTRIAL", "MUNICIPAL"]).optional().default("SINGLE_FAMILY"),
  address: z.string().min(3),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  squareFeet: z.number().int().positive().optional(),
  utilityName: z.string().optional(),
  timezone: z.string().optional(),
  metadata: z.any().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");
  const where = organizationId
    ? { organizationId, organization: { members: { some: { userId: auth.user.id, status: "ACTIVE" } } } }
    : { userId: auth.user.id };
  const properties = await prisma.property.findMany({ where, include: { utilityAccounts: true }, orderBy: { createdAt: "desc" } });
  return ok({ properties });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const { data, error } = await parseBody(request, propertySchema);
  if (error) return err("Validation failed", 400, error);

  if (data.organizationId) {
    const access = await requireOrganizationRole(auth.user.id, data.organizationId, ["OWNER", "ADMIN", "MANAGER"]);
    if (!access.allowed) return err(access.error, access.status);
  }
  const limit = await checkPropertyLimit(auth.user.id, data.organizationId || null);
  if (!limit.allowed) return err(limit.error, limit.status || 403, limit);

  const property = await prisma.property.create({ data: { userId: auth.user.id, ...data } });
  return ok({ property, message: "Property added." }, 201);
}
