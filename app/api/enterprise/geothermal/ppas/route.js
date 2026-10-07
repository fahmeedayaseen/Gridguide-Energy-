import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";
import { logAudit } from "@/lib/audit.js";
import { estimatePpaValue } from "@/lib/geothermal-metrics.mjs";
import { z } from "zod";

export const ppaSchema = z.object({
  propertyId: z.string().nullable().optional(),
  assetId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(150),
  seller: z.string().trim().min(1).max(150),
  utility: z.string().trim().max(150).nullable().optional(),
  status: z.enum(["PROPOSED", "PENDING_APPROVAL", "ACTIVE", "EXPIRED", "TERMINATED"]).default("PROPOSED"),
  contractedMw: z.coerce.number().positive(),
  termYears: z.coerce.number().int().min(1).max(100),
  capacityFactorPct: z.coerce.number().min(1).max(100).default(90),
  pricePerMwh: z.coerce.number().nonnegative().nullable().optional(),
  annualEscalationPct: z.coerce.number().min(-20).max(50).nullable().optional(),
  signedAt: z.string().datetime().nullable().optional(),
  deliveryStartAt: z.string().datetime().nullable().optional(),
  deliveryEndAt: z.string().datetime().nullable().optional(),
  regulatoryApproval: z.enum(["NOT_REQUIRED", "PENDING", "APPROVED", "REJECTED"]).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
}).strict();

async function validateLinks(orgId, data) {
  if (data.propertyId) {
    const property = await prisma.enterpriseProperty.count({ where: { id: data.propertyId, orgId } });
    if (!property) return "Property not found";
  }
  if (data.assetId) {
    const asset = await prisma.enterpriseEnergyAsset.count({ where: { id: data.assetId, orgId } });
    if (!asset) return "Energy asset not found";
  }
  return null;
}

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseRole(auth.user.id, "Viewer");
  if (!access.allowed) return err(access.error, access.status);
  const ppas = await prisma.enterpriseGeothermalPpa.findMany({ where: { orgId: access.org.id }, include: { property: { select: { id: true, name: true } }, asset: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } });
  return ok({ ppas: ppas.map((ppa) => ({ ...ppa, valueEstimate: estimatePpaValue(ppa) })), yourRole: access.role });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);
  const { data, error } = await parseBody(request, ppaSchema);
  if (error) return err("Validation failed", 400, error);
  const linkError = await validateLinks(access.org.id, data);
  if (linkError) return err(linkError, 404);
  const dates = ["signedAt", "deliveryStartAt", "deliveryEndAt"];
  const createData = { ...data, orgId: access.org.id };
  for (const field of dates) createData[field] = data[field] ? new Date(data[field]) : null;
  const ppa = await prisma.enterpriseGeothermalPpa.create({ data: createData });
  await logAudit({ actorUserId: auth.user.id, actorRole: access.role, action: "GEOTHERMAL_PPA_ADDED", targetType: "EnterpriseGeothermalPpa", targetId: ppa.id, orgId: access.org.id, category: "OTHER", metadata: { name: ppa.name, seller: ppa.seller, contractedMw: ppa.contractedMw } });
  return ok({ ppa: { ...ppa, valueEstimate: estimatePpaValue(ppa) }, message: "Geothermal PPA added." }, 201);
}
