/**
 * GET  /api/enterprise/energy-water/deliveries?contractId=&from=&to= — Viewer+ or API key
 * POST /api/enterprise/energy-water/deliveries — Manager+ or API key
 *   One delivery, or { deliveries: [...] } (max 500).
 *
 * Actual energy delivered under a supply contract for a settlement period
 * (periodEnd is exclusive). Send an externalId with settlement feeds: the same
 * (source, externalId) updates the stored delivery instead of duplicating it.
 * Deliveries sent with an API key default to source "API".
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { logAudit } from "@/lib/audit.js";
import { resolveEnterpriseActor, auditActor, auditActorMeta } from "@/lib/enterprise-api-keys.js";
import { validateDeliveriesBody } from "@/lib/energy-water-schemas.js";

const include = { contract: { select: { id: true, name: true, resourceType: true, contractedMw: true } } };

export async function GET(request) {
  const ctx = await resolveEnterpriseActor(request, "Viewer", { allowApiKey: true });
  if (ctx.error) return err(ctx.error, ctx.status);
  const p = new URL(request.url).searchParams;
  const contractId = p.get("contractId") || null;
  const from = p.get("from") ? new Date(p.get("from")) : null;
  const to = p.get("to") ? new Date(p.get("to")) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return err("from/to must be dates", 400);
  if (contractId) {
    const owned = await prisma.enterpriseGeothermalPpa.count({ where: { id: contractId, orgId: ctx.org.id } });
    if (!owned) return err("Contract not found", 404);
  }
  const deliveries = await prisma.enterpriseContractDelivery.findMany({
    where: {
      orgId: ctx.org.id,
      ...(contractId && { contractId }),
      ...(from && { periodEnd: { gt: from } }),
      ...(to && { periodStart: { lt: to } }),
    },
    include,
    orderBy: [{ periodStart: "desc" }, { id: "desc" }],
    take: 1000,
  });
  return ok({ deliveries, yourRole: ctx.role });
}

export async function POST(request) {
  const ctx = await resolveEnterpriseActor(request, "Manager", { allowApiKey: true });
  if (ctx.error) return err(ctx.error, ctx.status);
  let body;
  try { body = await request.json(); } catch { return err("Body must be JSON", 400); }
  if (ctx.actor.apiKeyId) {
    const tag = (r) => (r && typeof r === "object" && r.source === undefined ? { ...r, source: "API" } : r);
    body = Array.isArray(body?.deliveries) ? { ...body, deliveries: body.deliveries.map(tag) } : tag(body);
  }
  const { rows, errors } = validateDeliveriesBody(body);
  if (!rows) return err("Validation failed", 400, errors);

  const contractIds = [...new Set(rows.map((r) => r.contractId))];
  const owned = await prisma.enterpriseGeothermalPpa.findMany({ where: { id: { in: contractIds }, orgId: ctx.org.id }, select: { id: true } });
  const ownedSet = new Set(owned.map((c) => c.id));
  const missing = contractIds.filter((id) => !ownedSet.has(id));
  if (missing.length) return err(`Unknown contract id(s): ${missing.join(", ")}`, 404);

  const toData = (r) => ({
    orgId: ctx.org.id, contractId: r.contractId,
    periodStart: new Date(r.periodStart), periodEnd: new Date(r.periodEnd),
    deliveredMwh: r.deliveredMwh, peakDeliveredMw: r.peakDeliveredMw ?? null, curtailedMwh: r.curtailedMwh ?? null,
    source: r.source, externalId: r.externalId ?? null, notes: r.notes ?? null,
  });
  const keyed = new Map(), unkeyed = [];
  for (const r of rows) (r.externalId ? keyed.set(`${r.source}\u0000${r.externalId}`, toData(r)) : unkeyed.push(toData(r)));

  const result = await prisma.$transaction(async (tx) => {
    let updated = 0;
    if (keyed.size) {
      const existing = await tx.enterpriseContractDelivery.findMany({
        where: { orgId: ctx.org.id, OR: [...keyed.values()].map((d) => ({ source: d.source, externalId: d.externalId })) },
        select: { source: true, externalId: true },
      });
      const have = new Set(existing.map((e) => `${e.source}\u0000${e.externalId}`));
      for (const [key, data] of keyed) {
        if (have.has(key)) updated += 1;
        const { orgId, source, externalId, ...rest } = data;
        await tx.enterpriseContractDelivery.upsert({
          where: { orgId_source_externalId: { orgId, source, externalId } },
          create: data,
          update: rest,
        });
      }
    }
    if (unkeyed.length) await tx.enterpriseContractDelivery.createMany({ data: unkeyed });
    return { created: keyed.size - updated + unkeyed.length, updated };
  }, { timeout: 30000 });

  await logAudit({
    ...auditActor(ctx), action: "CONTRACT_DELIVERIES_IMPORTED", targetType: "EnterpriseContractDelivery", orgId: ctx.org.id,
    category: "OTHER", metadata: { submitted: rows.length, ...result, contractIds, ...auditActorMeta(ctx) },
  });
  const msg = `${result.created} deliver${result.created === 1 ? "y" : "ies"} saved${result.updated ? `, ${result.updated} updated` : ""}.`;
  return ok({ ...result, message: msg }, 201);
}
