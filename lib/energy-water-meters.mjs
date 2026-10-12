/**
 * Meter hierarchy rules for actual site load (formula load-ramp-v3-interval-split).
 *
 * Site load sums only meters that measure the whole site without overlap:
 *   - Only top-level (no parent) MAIN or SETTLEMENT meters can count.
 *     SUB meters sit under a parent and CHECK meters duplicate another meter;
 *     neither is ever added to site load (that would double count).
 *   - If a preferred settlement meter is in effect, it is authoritative and
 *     used ALONE (lowest settlementPriority, then id, if several are marked).
 *   - Otherwise every effective top-level MAIN/SETTLEMENT meter is summed;
 *     validation keeps their combined coverage ≤ 100%, so they can't overlap.
 *   - Readings with no meter are used only for sites with no meters at all
 *     (legacy behaviour: one implicit whole-site meter at 100% coverage).
 *
 * Nothing is scaled up: if the counted meters cover 60% of the site, load is
 * reported as partial with meterCoveragePct = 60, not extrapolated.
 *
 * When meter coverage changes during a reporting month, monthly load is
 * calculated using each meter's effective service dates (see siteMonthlyLoad).
 */

export const LOAD_FORMULA_VERSION = "load-ramp-v3-interval-split";
export const METER_LEVELS = Object.freeze(["MAIN", "SETTLEMENT", "SUB", "CHECK"]);
const COUNTABLE = new Set(["MAIN", "SETTLEMENT"]);
const MS_PER_HOUR = 3600 * 1000;
const COVERAGE_EPSILON = 0.01;

const t = (v) => (v ? new Date(v).getTime() : null);
const round = (v, d = 2) => (v === null || v === undefined ? null : Number(Number(v).toFixed(d)));

/** Is the meter in service at time `at` (effectiveFrom ≤ at < effectiveTo)? */
export function meterEffectiveAt(meter, at) {
  const x = t(at);
  return t(meter.effectiveFrom) <= x && (meter.effectiveTo == null || x < t(meter.effectiveTo));
}

function rangesOverlap(a, b) {
  const aFrom = t(a.effectiveFrom), aTo = a.effectiveTo ? t(a.effectiveTo) : Infinity;
  const bFrom = t(b.effectiveFrom), bTo = b.effectiveTo ? t(b.effectiveTo) : Infinity;
  return aFrom < bTo && bFrom < aTo;
}

/**
 * The meters whose readings make up site load at time `at`, and why.
 * @returns {{ meters: object[], mode: "PREFERRED_SETTLEMENT"|"SUM_MAIN_METERS"|"LEGACY_UNASSIGNED"|"NONE", coveragePct: number|null }}
 */
export function loadMetersAt(meters, at) {
  if (!meters.length) return { meters: [], mode: "LEGACY_UNASSIGNED", coveragePct: 100 };
  const candidates = meters.filter((m) => !m.parentMeterId && COUNTABLE.has(m.meterLevel) && meterEffectiveAt(m, at));
  if (!candidates.length) return { meters: [], mode: "NONE", coveragePct: null };
  const preferred = candidates.filter((m) => m.preferredSettlement)
    .sort((a, b) => (a.settlementPriority ?? Infinity) - (b.settlementPriority ?? Infinity) || String(a.id).localeCompare(String(b.id)));
  if (preferred.length) return { meters: [preferred[0]], mode: "PREFERRED_SETTLEMENT", coveragePct: Number(preferred[0].coveragePct ?? 100) };
  const coverage = candidates.reduce((s, m) => s + Number(m.coveragePct ?? 100), 0);
  return { meters: candidates, mode: "SUM_MAIN_METERS", coveragePct: Math.min(100, coverage) };
}

/**
 * Validate adding or changing a meter against the site's other meters.
 * Returns a list of problems (empty = OK).
 */
export function validateMeter(candidate, siteMeters) {
  const problems = [];
  const others = siteMeters.filter((m) => m.id !== candidate.id);
  const cov = Number(candidate.coveragePct ?? 100);
  if (!(cov > 0 && cov <= 100)) problems.push("Coverage must be more than 0% and at most 100%.");
  if (candidate.effectiveTo && t(candidate.effectiveTo) <= t(candidate.effectiveFrom)) problems.push("Effective-to must be after effective-from.");

  if (candidate.parentMeterId) {
    const parent = others.find((m) => m.id === candidate.parentMeterId);
    if (!parent) problems.push("Parent meter must be another meter at the same site.");
    else {
      // Walk up the chain: the candidate must not be its own ancestor.
      const byId = new Map(others.map((m) => [m.id, m]));
      let cur = parent, hops = 0;
      while (cur && hops < 50) {
        if (cur.parentMeterId === candidate.id) { problems.push("That parent would create a loop in the meter hierarchy."); break; }
        cur = cur.parentMeterId ? byId.get(cur.parentMeterId) : null;
        hops += 1;
      }
    }
    if (candidate.preferredSettlement) problems.push("A sub-meter can't be the preferred settlement meter.");
  } else if (candidate.meterLevel === "SUB") {
    problems.push("A SUB meter needs a parent meter.");
  }

  const countable = (m) => !m.parentMeterId && COUNTABLE.has(m.meterLevel);
  if (countable(candidate) && !candidate.preferredSettlement) {
    // Top-level meters that are summed must not overlap: combined coverage ≤ 100%
    // for any period in which they are in service together.
    const concurrent = others.filter((m) => countable(m) && !m.preferredSettlement && rangesOverlap(m, candidate));
    const total = cov + concurrent.reduce((s, m) => s + Number(m.coveragePct ?? 100), 0);
    if (total > 100 + COVERAGE_EPSILON) {
      problems.push(`Overlapping coverage: with ${concurrent.map((m) => m.name).join(", ")} the main meters would cover ${round(total, 1)}% of the site. Lower the coverage, end the other meter's effective dates, make one a SUB/CHECK meter, or mark one as the preferred settlement meter.`);
    }
  }
  if (candidate.preferredSettlement) {
    const clash = others.find((m) => m.preferredSettlement && rangesOverlap(m, candidate));
    if (clash) problems.push(`"${clash.name}" is already the preferred settlement meter for overlapping dates.`);
  }
  return problems;
}

/** Meter-change instants strictly inside [start, end): effective dates of countable top-level meters. */
export function meterBoundariesWithin(meters, start, end) {
  const s = t(start), e = t(end);
  const out = new Set();
  for (const m of meters) {
    if (m.parentMeterId || !COUNTABLE.has(m.meterLevel)) continue; // SUB/CHECK changes never alter site load
    for (const v of [m.effectiveFrom, m.effectiveTo]) {
      const x = t(v);
      if (x !== null && x > s && x < e) out.add(x);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export const ESTIMATION_METHOD_MID_MONTH = "MID_MONTH_METER_CONFIGURATION";

/** Average MW and data coverage for one selection of meters over one period. */
function loadForPeriod(sel, rows, hours) {
  const counted = sel.mode === "LEGACY_UNASSIGNED"
    ? rows.filter((r) => r.meterId == null)
    : rows.filter((r) => sel.meters.some((m) => m.id === r.meterId));
  const meterIds = sel.meters.map((m) => m.id);
  if (!counted.length) {
    return { actualMw: null, measuredMwh: null, status: "UNAVAILABLE", dataCoveragePct: 0, meterCoveragePct: sel.coveragePct,
      mode: sel.mode, meterIds, missingMeterIds: meterIds };
  }
  // Sum each meter's rows (a meter may have several groups in the period).
  const perMeter = new Map();
  for (const r of counted) {
    const k = r.meterId ?? "";
    const acc = perMeter.get(k) || { kwh: 0, minutes: 0 };
    acc.kwh += Number(r.kwh); acc.minutes += Number(r.minutes);
    perMeter.set(k, acc);
  }
  // Each counted meter: its own average MW over the hours it reported.
  // Non-overlapping meters add up; data coverage is the least-covered meter's.
  let mw = 0, kwh = 0, minCoverage = Infinity;
  for (const acc of perMeter.values()) {
    const h = acc.minutes / 60;
    if (h > 0) mw += acc.kwh / h / 1000;
    kwh += acc.kwh;
    minCoverage = Math.min(minCoverage, Math.min(100, (h / hours) * 100));
  }
  const expected = sel.mode === "LEGACY_UNASSIGNED" ? 1 : sel.meters.length;
  if (perMeter.size < expected) minCoverage = 0; // a counted meter reported nothing in this period
  const missingMeterIds = sel.mode === "LEGACY_UNASSIGNED" ? [] : meterIds.filter((id) => !perMeter.has(id));
  const complete = !missingMeterIds.length && (sel.coveragePct ?? 0) >= 100 - COVERAGE_EPSILON;
  return { actualMw: mw, measuredMwh: kwh / 1000, status: complete ? "COMPLETE" : "PARTIAL", dataCoveragePct: minCoverage,
    meterCoveragePct: sel.coveragePct, mode: sel.mode, meterIds, missingMeterIds };
}

/**
 * Monthly actual load for one site (formula load-ramp-v3-interval-split).
 *
 * meterMonths: per-meter sums, already de-duplicated per meter + timestamp:
 *   [{ month: "YYYY-MM", meterId: string|null, kwh, minutes, count,
 *      firstAt?, lastEndAt? }]
 *   firstAt / lastEndAt (earliest reading start, latest reading end) make a row
 *   interval-level: the portfolio SQL emits one row per meter per span between
 *   meter-change instants. A row without them is a monthly total.
 *
 * Rule: when meter coverage changes during a reporting month, monthly load is
 * calculated using each meter's effective service dates —
 *   1. split the month at every countable meter's effective start/end date;
 *   2. in each interval, use only the meters active in that interval
 *      (SUB/CHECK never added; a preferred settlement meter is used alone);
 *   3. add the intervals (time-weighted) to obtain the monthly figure.
 * If interval-level allocation is unavailable (only monthly totals, or a
 * reading spans a meter change), the meter configuration active at mid-month
 * is used, the result is marked ESTIMATED and the assumption is disclosed.
 *
 * Returns { [month]: { actualMw, measuredMwh, status, dataCoveragePct, meterCoveragePct, mode, meterIds,
 *   missingMeterIds, unassignedIgnored, allocation, intervals, estimationMethod, assumption, coverageStatus } }
 *   status: COMPLETE    — measured; every counted meter reported in every interval and covered 100% of the site
 *           PARTIAL     — measured, but a counted meter is missing or covers < 100% in some interval
 *           ESTIMATED   — mid-month meter configuration used because splitting was impossible (never verified)
 *           UNAVAILABLE — no usable readings (actualMw null)
 */
export function siteMonthlyLoad(meters, meterMonths) {
  const byMonth = new Map();
  for (const r of meterMonths) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, []);
    byMonth.get(r.month).push(r);
  }
  const out = {};
  for (const [month, rows] of byMonth) {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    const monthHours = (end - start) / MS_PER_HOUR;
    const legacy = !meters.length;
    const unassignedIgnored = legacy ? 0 : rows.filter((r) => r.meterId == null).reduce((s, r) => s + (r.count ?? 1), 0);
    const usable = legacy ? rows : rows.filter((r) => r.meterId != null);

    // 1. Split the month at each meter's effective start/end date.
    const cuts = [start.getTime(), ...meterBoundariesWithin(meters, start, end), end.getTime()];
    const spans = cuts.slice(0, -1).map((from, i) => ({ from, to: cuts[i + 1] }));

    // Place each row in the interval holding it; impossible if a row is a
    // monthly total or one of its readings runs across a meter change.
    let splittable = true;
    const placed = spans.map(() => []);
    for (const r of usable) {
      if (spans.length === 1) { placed[0].push(r); continue; }
      const a = t(r.firstAt), b = t(r.lastEndAt);
      const i = a === null ? -1 : spans.findIndex((s) => a >= s.from && a < s.to);
      if (i < 0 || b === null || (b > spans[i].to && i < spans.length - 1)) { splittable = false; break; }
      placed[i].push(r);
    }

    if (!splittable) {
      // Fallback: meter configuration at mid-month over the whole month — ESTIMATED, assumption disclosed.
      const mid = new Date((start.getTime() + end.getTime()) / 2);
      const sel = loadMetersAt(meters, mid);
      const p = loadForPeriod(sel, usable, monthHours);
      out[month] = {
        actualMw: round(p.actualMw, 3),
        measuredMwh: round(p.measuredMwh, 3),
        status: p.status === "UNAVAILABLE" ? "UNAVAILABLE" : "ESTIMATED",
        coverageStatus: p.status,
        dataCoveragePct: round(p.dataCoveragePct, 1),
        meterCoveragePct: p.meterCoveragePct,
        mode: p.mode,
        meterIds: p.meterIds,
        missingMeterIds: p.missingMeterIds,
        unassignedIgnored,
        allocation: "MID_MONTH_ESTIMATE",
        estimationMethod: ESTIMATION_METHOD_MID_MONTH,
        assumption: `Meter coverage changed during ${month}, but the readings could not be split at the meters' effective dates `
          + `(only monthly totals were available, or a reading spans a meter change). Load uses the meter configuration active at mid-month `
          + `(${mid.toISOString().slice(0, 10)}: ${sel.meters.map((m) => m.name || m.id).join(", ") || "no countable meter"}) and is an estimate, not a verified figure.`,
        intervals: [],
      };
      continue;
    }

    // 2. Each interval uses only the meters active in it.
    const intervals = spans.map((s, i) => {
      const hours = (s.to - s.from) / MS_PER_HOUR;
      const p = loadForPeriod(loadMetersAt(meters, new Date(s.from)), placed[i], hours);
      return { from: new Date(s.from).toISOString(), to: new Date(s.to).toISOString(), hours, ...p };
    });

    // 3. Add the intervals to obtain the monthly total.
    const withData = intervals.filter((iv) => iv.actualMw !== null);
    const measuredHours = withData.reduce((s, iv) => s + iv.hours, 0);
    const actualMw = measuredHours ? withData.reduce((s, iv) => s + iv.actualMw * iv.hours, 0) / measuredHours : null;
    const measuredMwh = withData.length ? withData.reduce((s, iv) => s + iv.measuredMwh, 0) : null;
    const status = !withData.length ? "UNAVAILABLE" : intervals.every((iv) => iv.status === "COMPLETE") ? "COMPLETE" : "PARTIAL";
    const covs = intervals.map((iv) => iv.meterCoveragePct).filter((v) => v !== null && v !== undefined);
    const modes = [...new Set(intervals.map((iv) => iv.mode))];
    out[month] = {
      actualMw: round(actualMw, 3),
      measuredMwh: round(measuredMwh, 3),
      status,
      dataCoveragePct: round(intervals.reduce((s, iv) => s + iv.dataCoveragePct * iv.hours, 0) / monthHours, 1),
      meterCoveragePct: covs.length ? Math.min(...covs) : null,
      mode: modes.length === 1 ? modes[0] : "MIXED",
      meterIds: [...new Set(intervals.flatMap((iv) => iv.meterIds))],
      missingMeterIds: [...new Set(intervals.flatMap((iv) => iv.missingMeterIds))],
      unassignedIgnored,
      allocation: "METER_EFFECTIVE_DATES",
      intervals: intervals.length > 1
        ? intervals.map((iv) => ({ ...iv, actualMw: round(iv.actualMw, 3), measuredMwh: round(iv.measuredMwh, 3), dataCoveragePct: round(iv.dataCoveragePct, 1), hours: round(iv.hours, 3) }))
        : [],
    };
  }
  return out;
}

/**
 * SQL for siteMonthlyLoad() input. `where` filters "EnterpriseSustainabilityReading"
 * and must bind the org as $1 (meter-change instants are read for the same org).
 * One row per (site, meter, month, span between meter changes):
 *   propertyId, meterId, month, kwh, minutes, count, firstAt, lastEndAt (ISO, UTC)
 */
export function buildLoadIntervalSql(where) {
  const isoUtc = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
  return `WITH d AS (
      SELECT DISTINCT ON ("propertyId", COALESCE("meterId", ''), "recordedAt")
        "propertyId", "meterId", "recordedAt", "facilityEnergyKwh", "intervalMinutes"
      FROM "EnterpriseSustainabilityReading"
      WHERE ${where}
      ORDER BY "propertyId", COALESCE("meterId", ''), "recordedAt", "updatedAt" DESC, "id" DESC
    ), b AS (
      SELECT "propertyId", "effectiveFrom" AS "at" FROM "EnterpriseMeter"
        WHERE "orgId" = $1 AND "parentMeterId" IS NULL AND "meterLevel" IN ('MAIN', 'SETTLEMENT')
      UNION
      SELECT "propertyId", "effectiveTo" FROM "EnterpriseMeter"
        WHERE "orgId" = $1 AND "parentMeterId" IS NULL AND "meterLevel" IN ('MAIN', 'SETTLEMENT') AND "effectiveTo" IS NOT NULL
    ), s AS (
      SELECT d.*, to_char(d."recordedAt", 'YYYY-MM') AS "month",
        (SELECT COUNT(*) FROM b WHERE b."propertyId" = d."propertyId" AND b."at" <= d."recordedAt") AS "seg"
      FROM d
    )
    SELECT "propertyId", "meterId", "month",
      SUM("facilityEnergyKwh")::float8 AS "kwh", SUM("intervalMinutes")::float8 AS "minutes", COUNT(*)::int AS "count",
      to_char(MIN("recordedAt"), ${isoUtc}) AS "firstAt",
      to_char(MAX("recordedAt" + "intervalMinutes" * INTERVAL '1 minute'), ${isoUtc}) AS "lastEndAt"
    FROM s
    GROUP BY "propertyId", "meterId", "month", "seg"
    ORDER BY 1, 3, 2, 7`;
}
