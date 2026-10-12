/**
 * Meter hierarchy rules for actual site load (formula load-ramp-v2-meters).
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
 */

export const LOAD_FORMULA_VERSION = "load-ramp-v2-meters";
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

/**
 * Monthly actual load for one site from per-meter monthly sums.
 * meterMonths: [{ month: "YYYY-MM", meterId: string|null, kwh, minutes }]
 *   (meterId null = readings with no meter; already de-duplicated per meter+timestamp)
 * Returns { [month]: { actualMw, status, dataCoveragePct, meterCoveragePct, mode, meterIds, missingMeterIds, unassignedIgnored } }.
 *   status: COMPLETE — every counted meter reported and they cover 100% of the site
 *           PARTIAL  — some counted meter didn't report, or counted meters cover < 100%
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
    // Evaluate the meter set at mid-month (documented simplification for meters that change mid-month).
    const mid = new Date((start.getTime() + end.getTime()) / 2);
    const sel = loadMetersAt(meters, mid);
    const counted = sel.mode === "LEGACY_UNASSIGNED"
      ? rows.filter((r) => r.meterId == null)
      : rows.filter((r) => sel.meters.some((m) => m.id === r.meterId));
    const unassignedIgnored = sel.mode === "LEGACY_UNASSIGNED" ? 0 : rows.filter((r) => r.meterId == null).reduce((s, r) => s + (r.count ?? 1), 0);
    if (!counted.length) {
      out[month] = { actualMw: null, status: "UNAVAILABLE", dataCoveragePct: 0, meterCoveragePct: sel.coveragePct, mode: sel.mode,
        meterIds: sel.meters.map((m) => m.id), missingMeterIds: sel.meters.map((m) => m.id), unassignedIgnored };
      continue;
    }
    // Each counted meter: its own average MW over the hours it reported.
    // Non-overlapping meters add up; data coverage is the least-covered meter's.
    let mw = 0, minCoverage = Infinity;
    const expected = sel.mode === "LEGACY_UNASSIGNED" ? 1 : sel.meters.length;
    for (const r of counted) {
      const hours = Number(r.minutes) / 60;
      if (hours > 0) mw += Number(r.kwh) / hours / 1000;
      minCoverage = Math.min(minCoverage, Math.min(100, (hours / monthHours) * 100));
    }
    if (counted.length < expected) minCoverage = 0; // a counted meter reported nothing this month
    const reported = new Set(counted.map((r) => r.meterId));
    const missingMeterIds = sel.mode === "LEGACY_UNASSIGNED" ? [] : sel.meters.filter((m) => !reported.has(m.id)).map((m) => m.id);
    const complete = !missingMeterIds.length && (sel.coveragePct ?? 0) >= 100 - COVERAGE_EPSILON;
    out[month] = {
      actualMw: round(mw, 3),
      status: complete ? "COMPLETE" : "PARTIAL",
      missingMeterIds,
      dataCoveragePct: round(minCoverage, 1),
      meterCoveragePct: sel.coveragePct,
      mode: sel.mode,
      meterIds: sel.meters.map((m) => m.id),
      unassignedIgnored,
    };
  }
  return out;
}
