/**
 * Supply contracts (any resource: geothermal, solar, wind, hydro, nuclear, gas…).
 * Canonical path: /api/enterprise/energy-water/contracts (this path is kept as an alias).
 * GET  — Viewer+, or an API key (pricing fields omitted). ?propertyId= &resourceType=
 * POST — Manager+
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
  const ctx = await resolveEnterpriseActor(request, "Viewer", { allowApiKey: true });
  if (ctx.error) return err(ctx.error, ctx.status);
  const params = new URL(request.url).searchParams;
  const propertyId = params.get("propertyId") || null;
  const ppas = await prisma.enterpriseGeothermalPpa.findMany({
    where: { orgId: ctx.org.id, ...(propertyId && { propertyId }), ...(params.get("resourceType") && { resourceType: params.get("resourceType") }) },
    include, orderBy: { createdAt: "desc" },
  });
  // Integrations (API keys) get contract ids for delivery feeds, never pricing.
  if (ctx.actor.apiKeyId) {
    const contracts = ppas.map(({ pricePerMwh, annualEscalationPct, notes, ...rest }) => rest);
    return ok({ contracts, ppas: contracts, yourRole: ctx.role });
  }
  const contracts = ppas.map((ppa) => ({ ...ppa, valueEstimate: estimatePpaValue(ppa) }));
  return ok({ contracts, ppas: contracts, yourRole: ctx.role });
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
  return ok({ ppa: { ...ppa, valueEstimate: estimatePpaValue(ppa) }, message: "Contract added." }, 201);
}
