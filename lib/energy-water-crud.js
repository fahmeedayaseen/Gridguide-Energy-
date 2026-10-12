/**
 * Shared list/create/update/delete handlers for the Energy & Water records
 * (load ramp steps, regulatory milestones, cost allocations).
 *
 * Every handler: resolves the caller's org (user session or, where allowed,
 * API key), checks that referenced property/asset/contract ids belong to that
 * org, validates with zod, and writes an audit-log entry. The org id always
 * comes from the session/key, never from the request body.
 */
import { prisma } from "./db.js";
import { ok, err, parseBody } from "./auth.js";
import { logAudit } from "./audit.js";
import { resolveEnterpriseActor, auditActor, auditActorMeta } from "./enterprise-api-keys.js";
import { checkOwnedLinks } from "./geothermal-store.js";
import { toDates } from "./geothermal-schemas.js";

const linkFields = (d) => ({ propertyId: d.propertyId, assetId: d.assetId, contractId: d.contractId });

/**
 * @param {object} cfg
 * @param {string} cfg.model           prisma delegate name, e.g. "enterpriseLoadRampStep"
 * @param {string} cfg.label           human label for messages, e.g. "Load ramp step"
 * @param {string} cfg.auditTarget     audit targetType
 * @param {string} cfg.auditAction     audit action prefix, e.g. "LOAD_RAMP_STEP"
 * @param {string} cfg.auditCategory   audit category
 * @param {import("zod").ZodTypeAny} cfg.createSchema
 * @param {import("zod").ZodTypeAny} cfg.updateSchema
 * @param {string[]} cfg.dateFields
 * @param {object} [cfg.include]
 * @param {object|object[]} cfg.orderBy
 * @param {(params: URLSearchParams) => object} [cfg.filters]  extra where-clause from query params
 * @param {(merged: object) => string|null} [cfg.validateMerged] check an updated record as a whole
 * @param {(rec: object) => object} [cfg.auditMeta]
 */
export function makeCollectionHandlers(cfg) {
  async function GET(request) {
    const ctx = await resolveEnterpriseActor(request, "Viewer");
    if (ctx.error) return err(ctx.error, ctx.status);
    const params = new URL(request.url).searchParams;
    const propertyId = params.get("propertyId") || null;
    if (propertyId) {
      const linkError = await checkOwnedLinks(ctx.org.id, { propertyId });
      if (linkError) return err(linkError, 404);
    }
    const items = await prisma[cfg.model].findMany({
      where: { orgId: ctx.org.id, ...(propertyId && { propertyId }), ...(cfg.filters ? cfg.filters(params) : {}) },
      ...(cfg.include && { include: cfg.include }),
      orderBy: cfg.orderBy,
      take: 1000,
    });
    return ok({ items, yourRole: ctx.role });
  }

  async function POST(request) {
    const ctx = await resolveEnterpriseActor(request, "Manager");
    if (ctx.error) return err(ctx.error, ctx.status);
    const { data, error } = await parseBody(request, cfg.createSchema);
    if (error) return err("Validation failed", 400, error);
    const linkError = await checkOwnedLinks(ctx.org.id, linkFields(data));
    if (linkError) return err(linkError, 404);

    const item = await prisma[cfg.model].create({
      data: { ...toDates(data, cfg.dateFields), orgId: ctx.org.id },
      ...(cfg.include && { include: cfg.include }),
    });
    await logAudit({
      ...auditActor(ctx), action: `${cfg.auditAction}_ADDED`, targetType: cfg.auditTarget, targetId: item.id,
      orgId: ctx.org.id, category: cfg.auditCategory, metadata: { ...(cfg.auditMeta ? cfg.auditMeta(item) : {}), ...auditActorMeta(ctx) },
    });
    return ok({ item, message: `${cfg.label} added.` }, 201);
  }

  return { GET, POST };
}

export function makeItemHandlers(cfg) {
  async function load(ctx, id) {
    return prisma[cfg.model].findFirst({ where: { id, orgId: ctx.org.id } });
  }

  async function PATCH(request, { params }) {
    const ctx = await resolveEnterpriseActor(request, "Manager");
    if (ctx.error) return err(ctx.error, ctx.status);
    const existing = await load(ctx, params.id);
    if (!existing) return err(`${cfg.label} not found`, 404);
    const { data, error } = await parseBody(request, cfg.updateSchema);
    if (error) return err("Validation failed", 400, error);
    const linkError = await checkOwnedLinks(ctx.org.id, linkFields(data));
    if (linkError) return err(linkError, 404);
    if (cfg.validateMerged) {
      const problem = cfg.validateMerged({ ...existing, ...data });
      if (problem) return err(problem, 400);
    }
    const item = await prisma[cfg.model].update({
      where: { id: existing.id },
      data: toDates(data, cfg.dateFields),
      ...(cfg.include && { include: cfg.include }),
    });
    await logAudit({
      ...auditActor(ctx), action: `${cfg.auditAction}_UPDATED`, targetType: cfg.auditTarget, targetId: item.id,
      orgId: ctx.org.id, category: cfg.auditCategory,
      metadata: { changed: Object.keys(data), before: Object.fromEntries(Object.keys(data).map((k) => [k, existing[k]])) },
    });
    return ok({ item, message: `${cfg.label} updated.` });
  }

  async function DELETE(request, { params }) {
    const ctx = await resolveEnterpriseActor(request, "Manager");
    if (ctx.error) return err(ctx.error, ctx.status);
    const existing = await load(ctx, params.id);
    if (!existing) return err(`${cfg.label} not found`, 404);
    await prisma[cfg.model].delete({ where: { id: existing.id } });
    await logAudit({
      ...auditActor(ctx), action: `${cfg.auditAction}_DELETED`, targetType: cfg.auditTarget, targetId: existing.id,
      orgId: ctx.org.id, category: cfg.auditCategory, metadata: cfg.auditMeta ? cfg.auditMeta(existing) : null,
    });
    return ok({ message: `${cfg.label} deleted.` });
  }

  return { PATCH, DELETE };
}
