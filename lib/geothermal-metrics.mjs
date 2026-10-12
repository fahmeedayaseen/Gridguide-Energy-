/**
 * Geothermal / data-center energy & water metrics.
 *
 * Missing is not zero. A reading may report only some measurements (e.g. a
 * meter feed with electricity but no water). Every measurement is nullable:
 *   - a total is null ("No data") when no reading in the period reported it;
 *   - a ratio only uses readings that reported BOTH of its inputs, so a
 *     reading with facility energy but no IT energy can't distort PUE.
 *
 * The same aggregate shape is produced in JS (aggregateReadings) and in SQL
 * (buildDailyAggregateSql), so the dashboard can aggregate in Postgres instead
 * of loading every reading into memory.
 */
const GALLONS_TO_LITERS = 3.785411784;
const HOURS_PER_YEAR = 8760;

export const MEASUREMENT_FIELDS = Object.freeze([
  "facilityEnergyKwh",
  "itEnergyKwh",
  "geothermalDeliveredKwh",
  "gridEnergyKwh",
  "coolingEnergyKwh",
  "waterWithdrawnGallons",
  "waterConsumedGallons",
  "baselineWaterConsumedGallons",
  "waterRecycledGallons",
  "waterDischargedGallons",
  "waterReclaimedImportedGallons",
  "waterStorageChangeGallons",
  "carbonAvoidedKg",
]);

/** Measurements that may be negative (everything else must be ≥ 0). */
export const SIGNED_FIELDS = Object.freeze(["waterStorageChangeGallons"]);

// ── Water verification (formula water-balance-v2) ─────────────────────────────
// Field meanings (all gallons, per reading interval):
//   waterWithdrawnGallons         potable / freshwater withdrawn from external supply
//   waterReclaimedImportedGallons non-potable reclaimed water delivered to the site (external input)
//   waterRecycledGallons          water recycled ON SITE — an internal loop, never counted as input
//   waterConsumedGallons          not returned to the immediate water environment (evaporated, etc.)
//   waterDischargedGallons        leaving the site as discharge
//   waterStorageChangeGallons     optional, signed: increase (+) or decrease (−) in on-site storage
// Balance: withdrawn + reclaimed imported ≈ consumed + discharged + storage change.
// Variance % = |inputs − outputs| ÷ max(inputs, 1) × 100.
//   ≤ 5%        VERIFIED
//   > 5% ≤ 10%  REVIEW      (metrics shown with a review flag, no verified badge)
//   > 10%       UNVERIFIED
// Any required field missing on any water reading in the period → UNVERIFIED.
export const WATER_FORMULA_VERSION = "water-balance-v2";
export const WATER_VERIFIED_MAX_PCT = 5;
export const WATER_REVIEW_MAX_PCT = 10;
export const WATER_CLAIM_FIELDS = Object.freeze([
  "waterWithdrawnGallons",
  "waterReclaimedImportedGallons",
  "waterRecycledGallons",
  "waterConsumedGallons",
  "waterDischargedGallons",
]);
const WATER_ANY_FIELDS = Object.freeze([...WATER_CLAIM_FIELDS, "baselineWaterConsumedGallons", "waterStorageChangeGallons"]);
const WATER_FIELD_LABELS = {
  waterWithdrawnGallons: "potable water withdrawn",
  waterReclaimedImportedGallons: "reclaimed water imported",
  waterRecycledGallons: "water recycled on site",
  waterConsumedGallons: "water consumed",
  waterDischargedGallons: "water discharged",
};
const STATUS_RANK = { VERIFIED: 0, REVIEW: 1, UNVERIFIED: 2 };

// Ratio inputs: [a, b]. Only readings reporting both are counted.
const PAIRS = Object.freeze({
  pue:      ["facilityEnergyKwh", "itEnergyKwh"],
  wue:      ["waterConsumedGallons", "itEnergyKwh"],
  geo:      ["geothermalDeliveredKwh", "facilityEnergyKwh"],
  cooling:  ["coolingEnergyKwh", "facilityEnergyKwh"],
  saved:    ["baselineWaterConsumedGallons", "waterConsumedGallons"],
});

const n = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const rounded = (value, digits = 2) => Number(n(value).toFixed(digits));

/** A measurement value, or null when it wasn't reported. */
export function measurement(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function emptyAggregate() {
  return {
    readingCount: 0,
    sums: Object.fromEntries(MEASUREMENT_FIELDS.map((f) => [f, 0])),
    counts: Object.fromEntries(MEASUREMENT_FIELDS.map((f) => [f, 0])),
    pairs: Object.fromEntries(Object.keys(PAIRS).map((p) => [p, { a: 0, b: 0, n: 0 }])),
    water: { anyN: 0, completeN: 0, withdrawn: 0, imported: 0, recycled: 0, consumed: 0, discharged: 0, storage: 0, storageN: 0 },
  };
}

function addReading(agg, row) {
  agg.readingCount += 1;
  const values = {};
  for (const field of MEASUREMENT_FIELDS) {
    const v = measurement(row?.[field]);
    values[field] = v;
    if (v !== null) {
      agg.sums[field] += v;
      agg.counts[field] += 1;
    }
  }
  for (const [name, [a, b]] of Object.entries(PAIRS)) {
    if (values[a] !== null && values[b] !== null) {
      agg.pairs[name].a += values[a];
      agg.pairs[name].b += values[b];
      agg.pairs[name].n += 1;
    }
  }
  if (WATER_ANY_FIELDS.some((f) => values[f] !== null)) agg.water.anyN += 1;
  if (WATER_CLAIM_FIELDS.every((f) => values[f] !== null)) {
    agg.water.completeN += 1;
    agg.water.withdrawn += values.waterWithdrawnGallons;
    agg.water.imported += values.waterReclaimedImportedGallons;
    agg.water.recycled += values.waterRecycledGallons;
    agg.water.consumed += values.waterConsumedGallons;
    agg.water.discharged += values.waterDischargedGallons;
    if (values.waterStorageChangeGallons !== null) {
      agg.water.storage += values.waterStorageChangeGallons;
      agg.water.storageN += 1;
    }
  }
  return agg;
}

export function aggregateReadings(readings = []) {
  return readings.reduce(addReading, emptyAggregate());
}

export function mergeAggregates(aggregates) {
  const out = emptyAggregate();
  for (const agg of aggregates) {
    out.readingCount += agg.readingCount;
    for (const f of MEASUREMENT_FIELDS) {
      out.sums[f] += agg.sums[f];
      out.counts[f] += agg.counts[f];
    }
    for (const p of Object.keys(PAIRS)) {
      out.pairs[p].a += agg.pairs[p].a;
      out.pairs[p].b += agg.pairs[p].b;
      out.pairs[p].n += agg.pairs[p].n;
    }
    for (const k of Object.keys(out.water)) out.water[k] += agg.water[k];
  }
  return out;
}

/**
 * Evidence status of the period's water figures (formula water-balance-v2).
 * Returns the API status object: verification_status (VERIFIED | REVIEW |
 * UNVERIFIED), missing_measurements, balance_variance_pct,
 * verification_reasons [{ code, message }], formula_version, and the inputs.
 */
export function waterClaimStatus(agg, { calculatedAt = new Date() } = {}) {
  const w = agg.water;
  const base = {
    formula_version: WATER_FORMULA_VERSION,
    calculated_at: (calculatedAt instanceof Date ? calculatedAt : new Date(calculatedAt)).toISOString(),
    thresholds: { verified_max_pct: WATER_VERIFIED_MAX_PCT, review_max_pct: WATER_REVIEW_MAX_PCT },
    required_measurements: [...WATER_CLAIM_FIELDS],
    readings_with_water: w.anyN,
    readings_complete: w.completeN,
  };
  if (w.anyN === 0) {
    return { ...base, verification_status: "UNVERIFIED", missing_measurements: [...WATER_CLAIM_FIELDS], balance_variance_pct: null, balance: null,
      verification_reasons: [{ code: "NO_WATER_READINGS", message: "No water readings in this period." }] };
  }
  if (w.completeN < w.anyN) {
    const missing = WATER_CLAIM_FIELDS.filter((f) => agg.counts[f] < w.anyN);
    const list = (missing.length ? missing : [...WATER_CLAIM_FIELDS]);
    return { ...base, verification_status: "UNVERIFIED", missing_measurements: list, balance_variance_pct: null, balance: null,
      verification_reasons: [{
        code: "MISSING_MEASUREMENTS",
        message: `${w.anyN - w.completeN} of ${w.anyN} water readings are missing ${list.map((f) => WATER_FIELD_LABELS[f]).join(", ")}.`,
      }] };
  }
  const inputs = w.withdrawn + w.imported;
  const outputs = w.consumed + w.discharged + w.storage;
  const variance = (Math.abs(inputs - outputs) / Math.max(inputs, 1)) * 100;
  const status = variance <= WATER_VERIFIED_MAX_PCT ? "VERIFIED" : variance <= WATER_REVIEW_MAX_PCT ? "REVIEW" : "UNVERIFIED";
  const reasons = [{
    code: status === "VERIFIED" ? "BALANCE_WITHIN_VERIFIED_THRESHOLD" : status === "REVIEW" ? "BALANCE_NEEDS_REVIEW" : "BALANCE_EXCEEDS_THRESHOLD",
    message: status === "VERIFIED"
      ? `Water balance closes within ${WATER_VERIFIED_MAX_PCT}% (variance ${rounded(variance, 2)}%).`
      : status === "REVIEW"
        ? `Water balance variance ${rounded(variance, 2)}% is above ${WATER_VERIFIED_MAX_PCT}% and at most ${WATER_REVIEW_MAX_PCT}% — review before claiming.`
        : `Water balance variance ${rounded(variance, 2)}% exceeds ${WATER_REVIEW_MAX_PCT}%: inputs (withdrawn + reclaimed imported) don't match outputs (consumed + discharged + storage change).`,
  }];
  if (w.storageN < w.completeN) {
    reasons.push({ code: "STORAGE_CHANGE_NOT_REPORTED", message: `${w.completeN - w.storageN} reading(s) didn't report a storage change; treated as no change.` });
  }
  return {
    ...base,
    verification_status: status,
    missing_measurements: [],
    balance_variance_pct: rounded(variance, 2),
    verification_reasons: reasons,
    balance: {
      inputs_gallons: rounded(inputs),
      outputs_gallons: rounded(outputs),
      withdrawn_gallons: rounded(w.withdrawn),
      reclaimed_imported_gallons: rounded(w.imported),
      recycled_onsite_gallons: rounded(w.recycled),
      consumed_gallons: rounded(w.consumed),
      discharged_gallons: rounded(w.discharged),
      storage_change_gallons: rounded(w.storage),
    },
  };
}

/**
 * Combine several periods' / sites' claims into one, exposing the
 * LEAST-trusted contributor: partial data can never roll up into a verified
 * portfolio claim. contributors: [{ key, label, claim }].
 */
export function combineWaterClaims(contributors) {
  const withWater = contributors.filter((c) => c.claim.readings_with_water > 0);
  if (!withWater.length) {
    return { ...waterClaimStatus({ water: { anyN: 0 }, counts: {} }), contributors: [] };
  }
  const worst = withWater.reduce((a, c) => (STATUS_RANK[c.claim.verification_status] > STATUS_RANK[a.claim.verification_status] ? c : a));
  const missing = [...new Set(withWater.flatMap((c) => c.claim.missing_measurements))];
  const variances = withWater.map((c) => c.claim.balance_variance_pct).filter((v) => v !== null);
  return {
    formula_version: WATER_FORMULA_VERSION,
    calculated_at: new Date().toISOString(),
    thresholds: worst.claim.thresholds,
    required_measurements: [...WATER_CLAIM_FIELDS],
    verification_status: worst.claim.verification_status,
    missing_measurements: missing,
    // Worst (highest) variance among contributors that could be balanced.
    balance_variance_pct: variances.length ? Math.max(...variances) : null,
    verification_reasons: withWater.flatMap((c) => c.claim.verification_reasons
      .filter((r) => c.claim.verification_status !== "VERIFIED" || r.code !== "BALANCE_WITHIN_VERIFIED_THRESHOLD" || withWater.length === 1)
      .map((r) => ({ ...r, scope: c.label }))),
    readings_with_water: withWater.reduce((s, c) => s + c.claim.readings_with_water, 0),
    readings_complete: withWater.reduce((s, c) => s + c.claim.readings_complete, 0),
    contributors: withWater.map((c) => ({ key: c.key, label: c.label, verification_status: c.claim.verification_status, balance_variance_pct: c.claim.balance_variance_pct })),
  };
}

export function metricsFromAggregate(agg) {
  const p = agg.pairs;
  const ratio = (pair, fn) => (pair.n > 0 ? fn(pair) : null);

  const pue = ratio(p.pue, ({ a, b }) => (b > 0 ? a / b : null));
  const wueLitersPerItKwh = ratio(p.wue, ({ a, b }) => (b > 0 ? (a * GALLONS_TO_LITERS) / b : null));
  const geothermalCoveragePct = ratio(p.geo, ({ a, b }) => (b > 0 ? Math.min(100, (a / b) * 100) : null));
  const coolingSharePct = ratio(p.cooling, ({ a, b }) => (b > 0 ? Math.min(100, (a / b) * 100) : null));
  // Water shares use only readings with complete water data, so they carry the
  // same evidence status as the period's water claim.
  const w = agg.water;
  const supplied = w.withdrawn + w.imported + w.recycled;
  // Recycled Water Share (%): on-site recycled ÷ all water supplied (potable + reclaimed imported + recycled).
  const recycledWaterSharePct = w.completeN > 0 && supplied > 0 ? Math.min(100, (w.recycled / supplied) * 100) : null;
  // Non-potable share (%): (reclaimed imported + recycled) ÷ all water supplied.
  const nonPotableSharePct = w.completeN > 0 && supplied > 0 ? Math.min(100, ((w.imported + w.recycled) / supplied) * 100) : null;
  const waterSavedGallons = ratio(p.saved, ({ a, b }) => Math.max(0, a - b));

  const totals = Object.fromEntries(
    MEASUREMENT_FIELDS.map((f) => [f, agg.counts[f] > 0 ? rounded(agg.sums[f]) : null])
  );
  totals.waterSavedGallons = waterSavedGallons === null ? null : rounded(waterSavedGallons);

  const r = (v, d) => (v === null ? null : rounded(v, d));
  const waterClaim = waterClaimStatus(agg);
  return {
    readingCount: agg.readingCount,
    totals,
    // How many readings reported each measurement, so the UI can show coverage.
    reportedCounts: { ...agg.counts },
    waterClaim,
    // WUE, recycled share and water saved inherit the period's evidence status.
    waterEvidenceStatus: waterClaim.verification_status,
    efficiency: {
      pue: r(pue, 3),
      wueLitersPerItKwh: r(wueLitersPerItKwh, 3),
      geothermalCoveragePct: r(geothermalCoveragePct, 1),
      coolingSharePct: r(coolingSharePct, 1),
      recycledWaterSharePct: r(recycledWaterSharePct, 1),
      nonPotableSharePct: r(nonPotableSharePct, 1),
    },
  };
}

export function calculateEnergyWaterMetrics(readings = []) {
  return metricsFromAggregate(aggregateReadings(readings));
}

export function buildDailyTrend(readings = []) {
  const days = new Map();
  for (const reading of readings) {
    const day = new Date(reading.recordedAt).toISOString().slice(0, 10);
    if (!days.has(day)) days.set(day, emptyAggregate());
    addReading(days.get(day), reading);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, agg]) => ({ date, ...metricsFromAggregate(agg) }));
}

// ── SQL aggregation ───────────────────────────────────────────────────────────
// Column names come only from the constant lists above (never from input), so
// building the SELECT list as a string is safe. All values are bound parameters.

const q = (col) => `"${col}"`;

/**
 * Daily aggregates for one org, UTC days — one row per (day, property) so
 * water claims can be evaluated per site and combined least-trusted-first.
 * Returns { sql, params } for prisma.$queryRawUnsafe(sql, ...params).
 */
export function buildDailyAggregateSql({ orgId, from, to, propertyId = null }) {
  const cols = [`to_char("recordedAt", 'YYYY-MM-DD') AS "day"`, `"propertyId" AS "propertyId"`, `COUNT(*)::int AS "n"`];
  for (const f of MEASUREMENT_FIELDS) {
    cols.push(`COALESCE(SUM(${q(f)}), 0)::float8 AS ${q(`s_${f}`)}`);
    cols.push(`COUNT(${q(f)})::int AS ${q(`c_${f}`)}`);
  }
  const anyWater = WATER_ANY_FIELDS.map((f) => `${q(f)} IS NOT NULL`).join(" OR ");
  const allWater = WATER_CLAIM_FIELDS.map((f) => `${q(f)} IS NOT NULL`).join(" AND ");
  cols.push(`(COUNT(*) FILTER (WHERE ${anyWater}))::int AS "w_any"`);
  cols.push(`(COUNT(*) FILTER (WHERE ${allWater}))::int AS "w_complete"`);
  for (const [alias, f] of [["w_withdrawn", "waterWithdrawnGallons"], ["w_imported", "waterReclaimedImportedGallons"], ["w_recycled", "waterRecycledGallons"], ["w_consumed", "waterConsumedGallons"], ["w_discharged", "waterDischargedGallons"], ["w_storage", "waterStorageChangeGallons"]]) {
    cols.push(`COALESCE(SUM(CASE WHEN ${allWater} THEN ${q(f)} END), 0)::float8 AS "${alias}"`);
  }
  cols.push(`(COUNT(*) FILTER (WHERE (${allWater}) AND ${q("waterStorageChangeGallons")} IS NOT NULL))::int AS "w_storage_n"`);
  for (const [name, [a, b]] of Object.entries(PAIRS)) {
    const both = `${q(a)} IS NOT NULL AND ${q(b)} IS NOT NULL`;
    cols.push(`COALESCE(SUM(CASE WHEN ${both} THEN ${q(a)} END), 0)::float8 AS ${q(`pa_${name}`)}`);
    cols.push(`COALESCE(SUM(CASE WHEN ${both} THEN ${q(b)} END), 0)::float8 AS ${q(`pb_${name}`)}`);
    cols.push(`(COUNT(*) FILTER (WHERE ${both}))::int AS ${q(`pn_${name}`)}`);
  }
  // Prisma stores DateTime as UTC in "timestamp without time zone". Bind the
  // bounds as ISO strings and convert explicitly, so the comparison never
  // depends on the database session's TimeZone setting.
  const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString();
  const params = [orgId, iso(from), iso(to)];
  let where = `"orgId" = $1 AND "recordedAt" >= ($2::timestamptz AT TIME ZONE 'UTC') AND "recordedAt" < ($3::timestamptz AT TIME ZONE 'UTC')`;
  if (propertyId) {
    params.push(propertyId);
    where += ` AND "propertyId" = $4`;
  }
  const sql = `SELECT ${cols.join(", ")} FROM "EnterpriseSustainabilityReading" WHERE ${where} GROUP BY 1, 2 ORDER BY 1, 2`;
  return { sql, params };
}

/** Convert one row of buildDailyAggregateSql output to an aggregate. */
export function aggregateFromSqlRow(row) {
  const agg = emptyAggregate();
  agg.readingCount = n(row.n);
  for (const f of MEASUREMENT_FIELDS) {
    agg.sums[f] = n(row[`s_${f}`]);
    agg.counts[f] = n(row[`c_${f}`]);
  }
  for (const p of Object.keys(PAIRS)) {
    agg.pairs[p] = { a: n(row[`pa_${p}`]), b: n(row[`pb_${p}`]), n: n(row[`pn_${p}`]) };
  }
  agg.water = {
    anyN: n(row.w_any), completeN: n(row.w_complete),
    withdrawn: n(row.w_withdrawn), imported: n(row.w_imported), recycled: n(row.w_recycled),
    consumed: n(row.w_consumed), discharged: n(row.w_discharged), storage: n(row.w_storage), storageN: n(row.w_storage_n),
  };
  return agg;
}

/**
 * Dashboard payload pieces from SQL rows (one per day × property):
 * overall metrics, daily trend, and per-site water claims. The overall water
 * claim is the least-trusted site's (combineWaterClaims), so partial data at
 * one site can't roll up into a verified portfolio claim.
 * propertyLabels: optional { [propertyId]: name } for reason messages.
 */
export function metricsFromDailySqlRows(rows = [], { propertyLabels = {} } = {}) {
  const parsed = rows.map((row) => ({ date: row.day, propertyId: row.propertyId ?? null, agg: aggregateFromSqlRow(row) }));
  const groupMerge = (keyFn) => {
    const m = new Map();
    for (const x of parsed) {
      const k = keyFn(x);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x.agg);
    }
    return [...m.entries()].map(([k, aggs]) => [k, mergeAggregates(aggs)]);
  };
  const metrics = metricsFromAggregate(mergeAggregates(parsed.map((x) => x.agg)));
  const trend = groupMerge((x) => x.date).sort(([a], [b]) => a.localeCompare(b)).map(([date, agg]) => ({ date, ...metricsFromAggregate(agg) }));
  const siteClaims = groupMerge((x) => x.propertyId).map(([key, agg]) => ({ key, label: propertyLabels[key] || key || "Unassigned", claim: waterClaimStatus(agg) }));
  if (siteClaims.length > 1) {
    metrics.waterClaim = combineWaterClaims(siteClaims);
    metrics.waterEvidenceStatus = metrics.waterClaim.verification_status;
  }
  return { metrics, trend, siteWaterClaims: siteClaims.map((c) => ({ propertyId: c.key, label: c.label, ...c.claim })) };
}

export function estimatePpaValue(ppa) {
  if (ppa?.pricePerMwh === null || ppa?.pricePerMwh === undefined) return null;
  const annualMwh = n(ppa.contractedMw) * HOURS_PER_YEAR * (n(ppa.capacityFactorPct || 90) / 100);
  const firstYearRevenue = annualMwh * n(ppa.pricePerMwh);
  const termYears = Math.max(0, Math.trunc(n(ppa.termYears)));
  const escalation = n(ppa.annualEscalationPct) / 100;
  let total = 0;
  for (let year = 0; year < termYears; year += 1) total += firstYearRevenue * ((1 + escalation) ** year);
  return { annualMwh: rounded(annualMwh), firstYearRevenue: rounded(firstYearRevenue), estimatedContractValue: rounded(total) };
}
