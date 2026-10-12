/**
 * Meter routes. Every create/update is checked against the site's other
 * meters with validateMeter() (lib/energy-water-meters.mjs): parent at the
 * same site, no loops, coverage bounds, no overlapping main-meter coverage,
 * one preferred settlement meter at a time.
 */
import { z } from "zod";
import { prisma } from "./db.js";
import { ok, err, parseBody } from "./auth.js";
import { logAudit } from "./audit.js";
import { resolveEnterpriseActor, auditActor } from "./enterprise-api-keys.js";
import { checkOwnedLinks } from "./geothermal-store.js";
import { toDates } from "./geothermal-schemas.js";
import { METER_LEVELS, validateMeter } from "./energy-water-meters.mjs";

const blankToNull = (v) => (v === "" ? null : v);
const formBool = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());
const fields = {
  propertyId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(150),
  meterLevel: z.enum(METER_LEVELS),
  parentMeterId: z.preprocess(blankToNull, z.string().min(1).max(64).nullable().optional()),
  coveragePct: z.coerce.number().gt(0).max(100),
  intervalMinutes: z.preprocess(blankToNull, z.coerce.number().int().min(1).max(44640).nullable().optional()),
  effectiveFrom: z.string().datetime({ offset: true }),
  effectiveTo: z.preprocess(blankToNull, z.string().datetime({ offset: true }).nullable().optional()),
  settlementPriority: z.preprocess(blankToNull, z.coerce.number().int().min(0).max(1000).nullable().optional()),
  preferredSettlement: formBool,
  utilityMeterNumber: z.preprocess(blankToNull, z.string().trim().max(100).nullable().optional()),
  notes: z.preprocess(blankToNull, z.string().trim().max(2000).nullable().optional()),
};
export const meterCreateSchema = z.object({ ...fields, coveragePct: fields.coveragePct.default(100), preferredSettlement: fields.preferredSettlement.default(false) }).strict();
export const meterUpdateSchema = z.object(fields).omit({ propertyId: true }).partial().strict()
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

const DATES = ["effectiveFrom", "effectiveTo"];
const include = { property: { select: { id: true, name: true } }, parent: { select: { id: true, name: true } } };

async function siteMeters(orgId, propertyId) {
  return prisma.enterpriseMeter.findMany({ where: { orgId, propertyId } });
}

export async function listMeters(request) {
  const ctx = await resolveEnterpriseActor(request, "Viewer");
  if (ctx.error) return err(ctx.error, ctx.status);
  const propertyId = new URL(request.url).searchParams.get("propertyId") || null;
  if (propertyId) {
    const linkError = await checkOwnedLinks(ctx.org.id, { propertyId });
    if (linkError) return err(linkError, 404);
  }
  const items = await prisma.enterpriseMeter.findMany({
    where: { orgId: ctx.org.id, ...(propertyId && { propertyId }) },
    include: { ...include, _count: { select: { readings: true } } },
    orderBy: [{ propertyId: "asc" }, { effectiveFrom: "asc" }, { name: "asc" }],
  });
  return ok({ items, yourRole: ctx.role });
}

export async function createMeter(request) {
  const ctx = await resolveEnterpriseActor(request, "Manager");
  if (ctx.error) return err(ctx.error, ctx.status);
  const { data, error } = await parseBody(request, meterCreateSchema);
  if (error) return err("Validation failed", 400, error);
  const linkError = await checkOwnedLinks(ctx.org.id, { propertyId: data.propertyId });
  if (linkError) return err(linkError, 404);
  const candidate = { id: "__new__", ...data };
  const problems = validateMeter(candidate, await siteMeters(ctx.org.id, data.propertyId));
  if (problems.length) return err(problems.join(" "), 409);
  const item = await prisma.enterpriseMeter.create({ data: { ...toDates(data, DATES), orgId: ctx.org.id }, include });
  await logAudit({ ...auditActor(ctx), action: "METER_ADDED", targetType: "EnterpriseMeter", targetId: item.id, orgId: ctx.org.id, category: "OTHER",
    metadata: { name: item.name, meterLevel: item.meterLevel, coveragePct: item.coveragePct, preferredSettlement: item.preferredSettlement } });
  return ok({ item, message: "Meter added." }, 201);
}

export async function updateMeter(request, { params }) {
  const ctx = await resolveEnterpriseActor(request, "Manager");
  if (ctx.error) return err(ctx.error, ctx.status);
  const existing = await prisma.enterpriseMeter.findFirst({ where: { id: params.id, orgId: ctx.org.id } });
  if (!existing) return err("Meter not found", 404);
  const { data, error } = await parseBody(request, meterUpdateSchema);
  if (error) return err("Validation failed", 400, error);
  const candidate = { ...existing, ...data };
  const problems = validateMeter(candidate, await siteMeters(ctx.org.id, existing.propertyId));
  if (problems.length) return err(problems.join(" "), 409);
  const item = await prisma.enterpriseMeter.update({ where: { id: existing.id }, data: toDates(data, DATES), include });
  await logAudit({ ...auditActor(ctx), action: "METER_UPDATED", targetType: "EnterpriseMeter", targetId: item.id, orgId: ctx.org.id, category: "OTHER",
    metadata: { changed: Object.keys(data), before: Object.fromEntries(Object.keys(data).map((k) => [k, existing[k]])) } });
  return ok({ item, message: "Meter updated." });
}

export async function deleteMeter(request, { params }) {
  const ctx = await resolveEnterpriseActor(request, "Manager");
  if (ctx.error) return err(ctx.error, ctx.status);
  const existing = await prisma.enterpriseMeter.findFirst({ where: { id: params.id, orgId: ctx.org.id } });
  if (!existing) return err("Meter not found", 404);
  const [readings, children] = await Promise.all([
    prisma.enterpriseSustainabilityReading.count({ where: { meterId: existing.id } }),
    prisma.enterpriseMeter.count({ where: { parentMeterId: existing.id } }),
  ]);
  if (readings || children) {
    return err(`This meter has ${readings} reading(s) and ${children} sub-meter(s). Set an effective-to date to retire it instead.`, 409);
  }
  await prisma.enterpriseMeter.delete({ where: { id: existing.id } });
  await logAudit({ ...auditActor(ctx), action: "METER_DELETED", targetType: "EnterpriseMeter", targetId: existing.id, orgId: ctx.org.id, category: "OTHER",
    metadata: { name: existing.name } });
  return ok({ message: "Meter deleted." });
}
