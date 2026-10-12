/**
 * GET  /api/enterprise/geothermal/ppas — Viewer+
 * POST /api/enterprise/geothermal/ppas — Manager+
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { logAudit } from "@/lib/audit.js";
import { resolveEnterpriseActor, auditActor } from "@/lib/enterprise-api-keys.js";
import { estimatePpaValue } from "@/lib/geothermal-metrics.mjs";
import { ppaCreateSchema, toDates } from "@/lib/geothermal-schemas.js";
import { checkOwnedLinks } from "@/lib/geothermal-store.js";

const DATE_FIELDS = ["signedAt", "deliveryStartAt", "deliveryEndAt"];
const include = { property: { select: { id: true, name: true } }, asset: { select: { id: true, name: true } } };

export async function GET(request) {
  const ctx = await resolveEnterpriseActor(request, "Viewer");
  if (ctx.error) return err(ctx.error, ctx.status);
  const ppas = await prisma.enterpriseGeothermalPpa.findMany({ where: { orgId: ctx.org.id }, include, orderBy: { createdAt: "desc" } });
  return ok({ ppas: ppas.map((ppa) => ({ ...ppa, valueEstimate: estimatePpaValue(ppa) })), yourRole: ctx.role });
}

export async function POST(request) {
  const ctx = await resolveEnterpriseActor(request, "Manager");
  if (ctx.error) return err(ctx.error, ctx.status);
  const { data, error } = await parseBody(request, ppaCreateSchema);
  if (error) return err("Validation failed", 400, error);
  const linkError = await checkOwnedLinks(ctx.org.id, data);
  if (linkError) return err(linkError, 404);

  const ppa = await prisma.enterpriseGeothermalPpa.create({
    data: { ...toDates(data, DATE_FIELDS), orgId: ctx.org.id },
    include,
  });
  await logAudit({
    ...auditActor(ctx), action: "GEOTHERMAL_PPA_ADDED", targetType: "EnterpriseGeothermalPpa", targetId: ppa.id,
    orgId: ctx.org.id, category: "OTHER", metadata: { name: ppa.name, seller: ppa.seller, contractedMw: ppa.contractedMw },
  });
  return ok({ ppa: { ...ppa, valueEstimate: estimatePpaValue(ppa) }, message: "Geothermal PPA added." }, 201);
}
