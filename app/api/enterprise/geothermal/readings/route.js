/**
 * GET  /api/enterprise/geothermal/readings
 *   ?propertyId= &assetId= &source= &from= &to= &limit=(1-500, default 100) &cursor=
 *   Newest first. Returns nextCursor when there are more.
 * POST /api/enterprise/geothermal/readings
 *   One reading, or { readings: [...] } with up to 500.
 *
 * Both accept a signed-in user (GET Viewer+, POST Manager+) or an Enterprise
 * API key: `Authorization: Bearer gg_live_...` (or `X-API-Key`).
 *
 * Measurements are optional; omit or send null for anything not measured —
 * it's recorded as "no data", never as zero. Send an externalId with every
 * integration reading: re-sending the same (source, externalId) updates the
 * stored value instead of creating a duplicate. API-key readings default to
 * source "API".
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { logAudit } from "@/lib/audit.js";
import { resolveEnterpriseActor, auditActor, auditActorMeta } from "@/lib/enterprise-api-keys.js";
import { validateReadingsBody, READING_SOURCES } from "@/lib/geothermal-schemas.js";
import { saveReadings, checkOwnedLinks } from "@/lib/geothermal-store.js";

const include = { property: { select: { id: true, name: true } }, asset: { select: { id: true, name: true } } };

function parseDateParam(value, { endOfDay = false } = {}) {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(d.getTime())) return undefined;
  if (dateOnly && endOfDay) d.setUTCDate(d.getUTCDate() + 1); // inclusive end date
  return d;
}

export async function GET(request) {
  const ctx = await resolveEnterpriseActor(request, "Viewer", { allowApiKey: true });
  if (ctx.error) return err(ctx.error, ctx.status);

  const params = new URL(request.url).searchParams;
  const limit = Math.min(500, Math.max(1, Number.parseInt(params.get("limit") || "100", 10) || 100));
  const propertyId = params.get("propertyId") || null;
  const assetId = params.get("assetId") || null;
  const source = params.get("source") || null;
  const cursor = params.get("cursor") || null;
  const from = parseDateParam(params.get("from"));
  const to = parseDateParam(params.get("to"), { endOfDay: true });
  if (from === undefined || to === undefined) return err("from/to must be dates (YYYY-MM-DD) or ISO timestamps", 400);
  if (source && !READING_SOURCES.includes(source)) return err(`source must be one of ${READING_SOURCES.join(", ")}`, 400);

  const linkError = await checkOwnedLinks(ctx.org.id, { propertyId, assetId });
  if (linkError) return err(linkError, 404);

  const where = {
    orgId: ctx.org.id,
    ...(propertyId && { propertyId }),
    ...(assetId && { assetId }),
    ...(source && { source }),
    ...((from || to) && { recordedAt: { ...(from && { gte: from }), ...(to && { lt: to }) } }),
  };

  let rows;
  try {
    rows = await prisma.enterpriseSustainabilityReading.findMany({
      where,
      include,
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
  } catch (e) {
    if (cursor) return err("Invalid cursor", 400);
    throw e;
  }
  const hasMore = rows.length > limit;
  const readings = hasMore ? rows.slice(0, limit) : rows;
  return ok({ readings, nextCursor: hasMore ? readings[readings.length - 1].id : null, yourRole: ctx.role });
}

export async function POST(request) {
  const ctx = await resolveEnterpriseActor(request, "Manager", { allowApiKey: true });
  if (ctx.error) return err(ctx.error, ctx.status);

  let body;
  try { body = await request.json(); } catch { return err("Body must be JSON", 400); }

  // Integrations default to source "API" unless they say otherwise.
  if (ctx.actor.apiKeyId) {
    const tag = (r) => (r && typeof r === "object" && r.source === undefined ? { ...r, source: "API" } : r);
    body = Array.isArray(body?.readings) ? { ...body, readings: body.readings.map(tag) } : tag(body);
  }

  const { rows, errors } = validateReadingsBody(body);
  if (!rows) return err("Validation failed", 400, errors);

  let result;
  try {
    result = await saveReadings(ctx.org.id, rows);
  } catch (e) {
    if (e?.status) return err(e.message, e.status);
    throw e;
  }

  await logAudit({
    ...auditActor(ctx), action: "SUSTAINABILITY_READINGS_IMPORTED", targetType: "EnterpriseSustainabilityReading",
    orgId: ctx.org.id, category: "OTHER",
    metadata: { submitted: rows.length, ...result, sources: [...new Set(rows.map((r) => r.source))], ...auditActorMeta(ctx) },
  });

  const parts = [`${result.created} reading${result.created === 1 ? "" : "s"} saved`];
  if (result.updated) parts.push(`${result.updated} updated`);
  return ok({ ...result, message: `${parts.join(", ")}.` }, 201);
}
