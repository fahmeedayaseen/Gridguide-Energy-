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
  "carbonAvoidedKg",
]);

// A water claim (water saved, recycled share, WUE) is "verified" only when
// every reading that reports any water figure reports all four of these, and
// the period's water balance closes: new water withdrawn ≈ consumed + discharged.
// Reclaimed/recycled water is reused on site and tracked separately — it is
// not part of withdrawal (see ENERGY_WATER_ACCOUNTABILITY.md).
export const WATER_CLAIM_FIELDS = Object.freeze([
  "waterWithdrawnGallons",
  "waterConsumedGallons",
  "waterDischargedGallons",
  "waterRecycledGallons",
]);
const WATER_ANY_FIELDS = Object.freeze([...WATER_CLAIM_FIELDS, "baselineWaterConsumedGallons"]);
export const WATER_BALANCE_TOLERANCE_PCT = 10;

// Ratio inputs: [a, b]. Only readings reporting both are counted.
const PAIRS = Object.freeze({
  pue:      ["facilityEnergyKwh", "itEnergyKwh"],
  wue:      ["waterConsumedGallons", "itEnergyKwh"],
  geo:      ["geothermalDeliveredKwh", "facilityEnergyKwh"],
  cooling:  ["coolingEnergyKwh", "facilityEnergyKwh"],
  recycled: ["waterRecycledGallons", "waterWithdrawnGallons"],
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
    water: { anyN: 0, completeN: 0, withdrawn: 0, consumed: 0, discharged: 0, recycled: 0 },
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
    agg.water.consumed += values.waterConsumedGallons;
    agg.water.discharged += values.waterDischargedGallons;
    agg.water.recycled += values.waterRecycledGallons;
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
 * Whether the period's water figures can be presented as verified.
 * status: NO_DATA | INCOMPLETE | UNBALANCED | VERIFIED
 */
export function waterClaimStatus(agg) {
  const w = agg.water;
  const base = {
    readingsWithWater: w.anyN,
    readingsComplete: w.completeN,
    requiredFields: [...WATER_CLAIM_FIELDS],
    tolerancePct: WATER_BALANCE_TOLERANCE_PCT,
  };
  if (w.anyN === 0) return { ...base, status: "NO_DATA", verified: false, missingFields: [...WATER_CLAIM_FIELDS], balanceGapPct: null };
  const missingFields = WATER_CLAIM_FIELDS.filter((f) => agg.counts[f] < w.anyN);
  if (w.completeN < w.anyN) {
    return { ...base, status: "INCOMPLETE", verified: false, missingFields: missingFields.length ? missingFields : [...WATER_CLAIM_FIELDS], balanceGapPct: null };
  }
  const outflow = w.consumed + w.discharged;
  const gap = Math.abs(w.withdrawn - outflow);
  const gapPct = w.withdrawn > 0 ? (gap / w.withdrawn) * 100 : (outflow > 0 ? 100 : 0);
  const balanced = gapPct <= WATER_BALANCE_TOLERANCE_PCT;
  return {
    ...base,
    status: balanced ? "VERIFIED" : "UNBALANCED",
    verified: balanced,
    missingFields: [],
    balanceGapPct: rounded(gapPct, 1),
    balance: {
      withdrawnGallons: rounded(w.withdrawn),
      consumedGallons: rounded(w.consumed),
      dischargedGallons: rounded(w.discharged),
      recycledGallons: rounded(w.recycled),
    },
  };
}

export function metricsFromAggregate(agg) {
  const p = agg.pairs;
  const ratio = (pair, fn) => (pair.n > 0 ? fn(pair) : null);

  const pue = ratio(p.pue, ({ a, b }) => (b > 0 ? a / b : null));
  const wueLitersPerItKwh = ratio(p.wue, ({ a, b }) => (b > 0 ? (a * GALLONS_TO_LITERS) / b : null));
  const geothermalCoveragePct = ratio(p.geo, ({ a, b }) => (b > 0 ? Math.min(100, (a / b) * 100) : null));
  const coolingSharePct = ratio(p.cooling, ({ a, b }) => (b > 0 ? Math.min(100, (a / b) * 100) : null));
  // Recycled Water Share (%): recycled / (new withdrawals + recycled). Withdrawn
  // must exclude recycled volumes, and both must cover the same interval.
  const recycledWaterSharePct = ratio(p.recycled, ({ a, b }) => (a + b > 0 ? (a / (a + b)) * 100 : null));
  const waterSavedGallons = ratio(p.saved, ({ a, b }) => Math.max(0, a - b));

  const totals = Object.fromEntries(
    MEASUREMENT_FIELDS.map((f) => [f, agg.counts[f] > 0 ? rounded(agg.sums[f]) : null])
  );
  totals.waterSavedGallons = waterSavedGallons === null ? null : rounded(waterSavedGallons);

  const r = (v, d) => (v === null ? null : rounded(v, d));
  return {
    readingCount: agg.readingCount,
    totals,
    // How many readings reported each measurement, so the UI can show coverage.
    reportedCounts: { ...agg.counts },
    waterClaim: waterClaimStatus(agg),
    efficiency: {
      pue: r(pue, 3),
      wueLitersPerItKwh: r(wueLitersPerItKwh, 3),
      geothermalCoveragePct: r(geothermalCoveragePct, 1),
      coolingSharePct: r(coolingSharePct, 1),
      recycledWaterSharePct: r(recycledWaterSharePct, 1),
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
 * Daily aggregates for one org, UTC days.
 * Returns { sql, params } for prisma.$queryRawUnsafe(sql, ...params).
 */
export function buildDailyAggregateSql({ orgId, from, to, propertyId = null }) {
  const cols = [`to_char("recordedAt", 'YYYY-MM-DD') AS "day"`, `COUNT(*)::int AS "n"`];
  for (const f of MEASUREMENT_FIELDS) {
    cols.push(`COALESCE(SUM(${q(f)}), 0)::float8 AS ${q(`s_${f}`)}`);
    cols.push(`COUNT(${q(f)})::int AS ${q(`c_${f}`)}`);
  }
  const anyWater = WATER_ANY_FIELDS.map((f) => `${q(f)} IS NOT NULL`).join(" OR ");
  const allWater = WATER_CLAIM_FIELDS.map((f) => `${q(f)} IS NOT NULL`).join(" AND ");
  cols.push(`(COUNT(*) FILTER (WHERE ${anyWater}))::int AS "w_any"`);
  cols.push(`(COUNT(*) FILTER (WHERE ${allWater}))::int AS "w_complete"`);
  for (const [alias, f] of [["w_withdrawn", "waterWithdrawnGallons"], ["w_consumed", "waterConsumedGallons"], ["w_discharged", "waterDischargedGallons"], ["w_recycled", "waterRecycledGallons"]]) {
    cols.push(`COALESCE(SUM(CASE WHEN ${allWater} THEN ${q(f)} END), 0)::float8 AS "${alias}"`);
  }
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
  const sql = `SELECT ${cols.join(", ")} FROM "EnterpriseSustainabilityReading" WHERE ${where} GROUP BY 1 ORDER BY 1`;
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
    withdrawn: n(row.w_withdrawn), consumed: n(row.w_consumed), discharged: n(row.w_discharged), recycled: n(row.w_recycled),
  };
  return agg;
}

/** Dashboard payload pieces from SQL rows: overall metrics + daily trend. */
export function metricsFromDailySqlRows(rows = []) {
  const daily = rows.map((row) => ({ date: row.day, agg: aggregateFromSqlRow(row) }));
  return {
    metrics: metricsFromAggregate(mergeAggregates(daily.map((d) => d.agg))),
    trend: daily.map(({ date, agg }) => ({ date, ...metricsFromAggregate(agg) })),
  };
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
