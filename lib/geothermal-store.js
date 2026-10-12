/**
 * Data access helpers for the Enterprise Energy & Water (geothermal) module.
 * Every function is scoped by orgId — callers pass the org resolved from the
 * signed-in user or API key, never one taken from the request body.
 */
import { prisma } from "./db.js";
import { MEASUREMENT_FIELDS } from "./geothermal-metrics.mjs";

/** Returns an error message if a referenced property/asset/contract isn't owned by the org, else null. */
export async function checkOwnedLinks(orgId, { propertyId, assetId, contractId } = {}, db = prisma) {
  if (propertyId) {
    const owned = await db.enterpriseProperty.count({ where: { id: propertyId, orgId } });
    if (!owned) return "Property not found";
  }
  if (assetId) {
    const owned = await db.enterpriseEnergyAsset.count({ where: { id: assetId, orgId } });
    if (!owned) return "Energy asset not found";
  }
  if (contractId) {
    const owned = await db.enterpriseGeothermalPpa.count({ where: { id: contractId, orgId } });
    if (!owned) return "Contract not found";
  }
  return null;
}

/** Prisma unique-constraint violation. */
export const isUniqueViolation = (e) => e?.code === "P2002";

const readingKey = (r) => `${r.source}\u0000${r.externalId}`;

/**
 * Save validated readings for one org, atomically.
 *
 * - Readings WITH an externalId are upserted on (org, source, externalId):
 *   re-sending a corrected meter value updates it instead of being silently
 *   dropped (the old createMany/skipDuplicates behavior). If the same key
 *   appears twice in one batch, the last one wins.
 * - Readings WITHOUT an externalId are inserted. Integrations should always
 *   send an externalId so retries can't create duplicates.
 *
 * All property/asset references are checked against the org first.
 * @returns {{ created: number, updated: number }} or throws { status, message }
 */
export async function saveReadings(orgId, rows) {
  const propertyIds = [...new Set(rows.map((r) => r.propertyId))];
  const assetIds = [...new Set(rows.map((r) => r.assetId).filter(Boolean))];
  const [properties, assets] = await Promise.all([
    prisma.enterpriseProperty.findMany({ where: { id: { in: propertyIds }, orgId }, select: { id: true } }),
    assetIds.length
      ? prisma.enterpriseEnergyAsset.findMany({ where: { id: { in: assetIds }, orgId }, select: { id: true } })
      : [],
  ]);
  const ownedProps = new Set(properties.map((p) => p.id));
  const ownedAssets = new Set(assets.map((a) => a.id));
  const missingProps = propertyIds.filter((id) => !ownedProps.has(id));
  const missingAssets = assetIds.filter((id) => !ownedAssets.has(id));
  if (missingProps.length || missingAssets.length) {
    const err = new Error(
      [missingProps.length && `Unknown property id(s): ${missingProps.join(", ")}`,
       missingAssets.length && `Unknown asset id(s): ${missingAssets.join(", ")}`].filter(Boolean).join(". ")
    );
    err.status = 404;
    throw err;
  }

  const toData = (r) => {
    const data = {
      orgId,
      propertyId: r.propertyId,
      assetId: r.assetId ?? null,
      recordedAt: new Date(r.recordedAt),
      intervalMinutes: r.intervalMinutes,
      source: r.source,
      externalId: r.externalId ?? null,
    };
    for (const f of MEASUREMENT_FIELDS) data[f] = r[f] ?? null;
    return data;
  };

  const keyed = new Map();
  const unkeyed = [];
  for (const r of rows) {
    if (r.externalId) keyed.set(readingKey(r), toData(r));
    else unkeyed.push(toData(r));
  }

  return prisma.$transaction(async (tx) => {
    let updated = 0;
    if (keyed.size) {
      const existing = await tx.enterpriseSustainabilityReading.findMany({
        where: { orgId, OR: [...keyed.values()].map((d) => ({ source: d.source, externalId: d.externalId })) },
        select: { source: true, externalId: true },
      });
      const existingKeys = new Set(existing.map(readingKey));
      for (const data of keyed.values()) {
        if (existingKeys.has(readingKey(data))) updated += 1;
        const { orgId: _o, source, externalId, ...rest } = data;
        await tx.enterpriseSustainabilityReading.upsert({
          where: { orgId_source_externalId: { orgId, source, externalId } },
          create: data,
          update: rest,
        });
      }
    }
    if (unkeyed.length) await tx.enterpriseSustainabilityReading.createMany({ data: unkeyed });
    return { created: keyed.size - updated + unkeyed.length, updated };
  }, { timeout: 30000 });
}
