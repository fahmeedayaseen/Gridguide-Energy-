/**
 * Data-center energy & water accountability calculations — vendor-neutral.
 *
 * Pure functions (no database access) so they can be unit-tested and reused
 * by API routes. Same rule as the readings metrics: nothing is estimated from
 * figures the user didn't enter. A missing input makes the result null
 * ("No data") instead of a guessed number.
 */

const HOURS_PER_YEAR = 8760;
const MS_PER_HOUR = 3600 * 1000;

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d = 2) => (v === null || v === undefined ? null : Number(Number(v).toFixed(d)));
const toDate = (v) => (v instanceof Date ? v : v ? new Date(v) : null);

// ── Resource taxonomy ─────────────────────────────────────────────────────────
// carbonFree: true / false / null (unknown — e.g. an unspecified grid mix).
export const RESOURCE_TYPES = Object.freeze({
  GEOTHERMAL: { label: "Geothermal", carbonFree: true, featured: true },
  SOLAR:      { label: "Solar", carbonFree: true },
  WIND:       { label: "Wind", carbonFree: true },
  HYDRO:      { label: "Hydro", carbonFree: true },
  NUCLEAR:    { label: "Nuclear", carbonFree: true },
  GAS:        { label: "Natural gas", carbonFree: false },
  DIESEL:     { label: "Diesel", carbonFree: false },
  STORAGE:    { label: "Storage", carbonFree: null, storage: true },
  GRID_MIX:   { label: "Grid mix", carbonFree: null },
  OTHER:      { label: "Other", carbonFree: null },
});
export const RESOURCE_KEYS = Object.freeze(Object.keys(RESOURCE_TYPES));

/** Which resource an energy asset represents (null for non-generation equipment). */
export const ASSET_RESOURCE = Object.freeze({
  GEOTHERMAL_GENERATION: "GEOTHERMAL",
  SOLAR: "SOLAR",
  WIND: "WIND",
  HYDRO: "HYDRO",
  NUCLEAR: "NUCLEAR",
  GAS_TURBINE: "GAS",
  RECIPROCATING_ENGINE: "GAS",
  FUEL_CELL: "GAS",
  DIESEL_GENERATOR: "DIESEL",
  BATTERY: "STORAGE",
  THERMAL_STORAGE: "STORAGE",
  UPS: "STORAGE",
  GROUND_SOURCE_HEAT_PUMP: null,
  CHILLER: null,
  GRID_CONNECTION: null,
});

const CONTRACTED_STATUSES = new Set(["ACTIVE", "PENDING_APPROVAL"]);

// ── Time helpers ──────────────────────────────────────────────────────────────
function overlapHours(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(aStart.getTime(), bStart ? bStart.getTime() : -Infinity);
  const end = Math.min(aEnd.getTime(), bEnd ? bEnd.getTime() : Infinity);
  return end > start ? (end - start) / MS_PER_HOUR : 0;
}

/** UTC month keys ("YYYY-MM") covering [from, to). */
export function monthsBetween(from, to) {
  const out = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (d < to) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

// ── Contracted vs delivered ───────────────────────────────────────────────────

/**
 * Energy the contract commits for [start, end), clipped to its delivery window.
 * Uses the contract's stated annual MWh when entered; otherwise MW × hours ×
 * capacity factor. Returns null when neither can be computed.
 */
export function contractedMwhForPeriod(contract, start, end) {
  const s = toDate(start), e = toDate(end);
  if (!s || !e || e <= s) return 0;
  const hours = overlapHours(s, e, toDate(contract.deliveryStartAt), toDate(contract.deliveryEndAt));
  if (hours === 0) return 0;
  const annual = num(contract.contractedAnnualMwh);
  if (annual !== null) return (annual * hours) / HOURS_PER_YEAR;
  const mw = num(contract.contractedMw);
  if (mw === null) return null;
  const cf = num(contract.capacityFactorPct) ?? 100;
  return mw * hours * (cf / 100);
}

/**
 * Delivered energy compared with what was contracted, per contract.
 * Only settlement periods that were actually reported are compared, so a
 * missing month never shows up as a 100% shortfall.
 */
export function deliveryPerformance(contracts, deliveries, { from, to } = {}) {
  const f = toDate(from), t = toDate(to);
  const inRange = (d) => (!f || toDate(d.periodEnd) > f) && (!t || toDate(d.periodStart) < t);
  const byContract = new Map(contracts.map((c) => [c.id, []]));
  for (const d of deliveries) if (byContract.has(d.contractId) && inRange(d)) byContract.get(d.contractId).push(d);

  const rows = contracts.map((c) => {
    const ds = byContract.get(c.id);
    if (!ds.length) {
      return { contractId: c.id, name: c.name, resourceType: c.resourceType || "GEOTHERMAL", reportedPeriods: 0,
        deliveredMwh: null, contractedMwh: null, deliveryPct: null, shortfallMwh: null, curtailedMwh: null,
        peakDeliveredMw: null, contractedMw: num(c.contractedMw), peakPct: null };
    }
    let delivered = 0, contracted = 0, contractedKnown = true, curtailed = null, peak = null;
    for (const d of ds) {
      delivered += Number(d.deliveredMwh) || 0;
      const cm = contractedMwhForPeriod(c, d.periodStart, d.periodEnd);
      if (cm === null) contractedKnown = false; else contracted += cm;
      if (num(d.curtailedMwh) !== null) curtailed = (curtailed ?? 0) + Number(d.curtailedMwh);
      if (num(d.peakDeliveredMw) !== null) peak = Math.max(peak ?? 0, Number(d.peakDeliveredMw));
    }
    const contractedMwh = contractedKnown ? contracted : null;
    const mw = num(c.contractedMw);
    return {
      contractId: c.id,
      name: c.name,
      resourceType: c.resourceType || "GEOTHERMAL",
      reportedPeriods: ds.length,
      deliveredMwh: round(delivered),
      contractedMwh: round(contractedMwh),
      deliveryPct: contractedMwh ? round((delivered / contractedMwh) * 100, 1) : null,
      shortfallMwh: contractedMwh !== null ? round(Math.max(0, contractedMwh - delivered)) : null,
      curtailedMwh: round(curtailed),
      peakDeliveredMw: round(peak, 3),
      contractedMw: mw,
      peakPct: peak !== null && mw ? round((peak / mw) * 100, 1) : null,
    };
  });

  const reported = rows.filter((r) => r.reportedPeriods > 0);
  const comparable = reported.filter((r) => r.contractedMwh !== null);
  const totDelivered = reported.reduce((s, r) => s + r.deliveredMwh, 0);
  const totContracted = comparable.reduce((s, r) => s + r.contractedMwh, 0);
  const totDeliveredComparable = comparable.reduce((s, r) => s + r.deliveredMwh, 0);
  return {
    contracts: rows,
    totals: {
      contractsReporting: reported.length,
      deliveredMwh: reported.length ? round(totDelivered) : null,
      contractedMwh: comparable.length ? round(totContracted) : null,
      deliveryPct: totContracted ? round((totDeliveredComparable / totContracted) * 100, 1) : null,
      shortfallMwh: comparable.length ? round(comparable.reduce((s, r) => s + r.shortfallMwh, 0)) : null,
    },
  };
}

// ── Portfolio mix ─────────────────────────────────────────────────────────────

/**
 * Contracted capacity, microgrid capacity and delivered energy by resource.
 * carbonFreeDeliveredPct counts only energy whose resource is known to be
 * carbon-free; energy from unknown mixes is reported separately, not assumed.
 */
export function resourceMix(contracts, assets, performance) {
  const mix = Object.fromEntries(RESOURCE_KEYS.map((k) => [k, {
    resource: k, label: RESOURCE_TYPES[k].label, carbonFree: RESOURCE_TYPES[k].carbonFree,
    contracts: 0, contractedMw: 0, firmMw: 0, microgridMw: 0, deliveredMwh: null,
  }]));
  for (const c of contracts) {
    const k = RESOURCE_TYPES[c.resourceType] ? c.resourceType : "OTHER";
    mix[k].contracts += 1;
    if (CONTRACTED_STATUSES.has(c.status)) {
      mix[k].contractedMw += num(c.contractedMw) ?? 0;
      mix[k].firmMw += num(c.firmCapacityMw) ?? 0;
    }
  }
  for (const a of assets) {
    const k = ASSET_RESOURCE[a.type];
    if (!k || !a.microgrid || a.status !== "ACTIVE") continue;
    mix[k].microgridMw += (num(a.ratedCapacityKw) ?? 0) / 1000;
  }
  for (const r of performance?.contracts || []) {
    if (r.deliveredMwh === null) continue;
    const k = RESOURCE_TYPES[r.resourceType] ? r.resourceType : "OTHER";
    mix[k].deliveredMwh = (mix[k].deliveredMwh ?? 0) + r.deliveredMwh;
  }

  const rows = Object.values(mix).filter((m) => m.contracts || m.microgridMw || m.deliveredMwh !== null)
    .map((m) => ({ ...m, contractedMw: round(m.contractedMw, 3), firmMw: round(m.firmMw, 3), microgridMw: round(m.microgridMw, 3), deliveredMwh: round(m.deliveredMwh) }));
  const delivered = rows.reduce((s, m) => s + (m.deliveredMwh ?? 0), 0);
  const carbonFree = rows.filter((m) => m.carbonFree === true).reduce((s, m) => s + (m.deliveredMwh ?? 0), 0);
  const unknown = rows.filter((m) => m.carbonFree === null && !RESOURCE_TYPES[m.resource].storage).reduce((s, m) => s + (m.deliveredMwh ?? 0), 0);
  return {
    resources: rows,
    deliveredMwh: delivered ? round(delivered) : null,
    carbonFreeDeliveredPct: delivered ? round((carbonFree / delivered) * 100, 1) : null,
    unknownMixDeliveredPct: delivered ? round((unknown / delivered) * 100, 1) : null,
  };
}

// ── Load ramp ─────────────────────────────────────────────────────────────────

/** The ramp step in effect at `at` (last step with effectiveDate ≤ at), or null. */
export function rampStepAt(steps, at) {
  const t = toDate(at).getTime();
  let current = null;
  for (const s of [...steps].sort((a, b) => toDate(a.effectiveDate) - toDate(b.effectiveDate))) {
    if (toDate(s.effectiveDate).getTime() <= t) current = s; else break;
  }
  return current;
}

/**
 * Planned vs actual average load per month for one property.
 * monthlyActual: either
 *   [{ month, actualMw, status, dataCoveragePct, meterCoveragePct, allocation, assumption, intervals }] from siteMonthlyLoad()
 *   (lib/energy-water-meters.mjs — the meter-aware path used by the API), or
 *   [{ month, kwh, minutes }] — a single implicit whole-site meter.
 */
export function rampComparison(steps, monthlyActual, { from, to }) {
  const actual = new Map(monthlyActual.map((m) => [m.month, m]));
  return monthsBetween(toDate(from), toDate(to)).map((month) => {
    const monthStart = new Date(`${month}-01T00:00:00.000Z`);
    const nextMonth = new Date(monthStart); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const step = rampStepAt(steps, monthStart);
    const a = actual.get(month);
    const monthHours = (nextMonth - monthStart) / MS_PER_HOUR;
    const plannedMw = step ? num(step.plannedLoadMw) : null;
    if (a && "actualMw" in a) {
      return {
        month,
        phase: step?.phase || null,
        plannedMw: round(plannedMw, 3),
        plannedPeakMw: round(step ? num(step.plannedPeakMw) : null, 3),
        actualMw: a.actualMw,
        loadStatus: a.status,
        // ESTIMATED = mid-month meter configuration used because readings couldn't be split at meter changes.
        loadAllocation: a.allocation ?? null,
        loadAssumption: a.assumption ?? null,
        loadIntervals: a.intervals?.length ? a.intervals : undefined,
        meterCoveragePct: a.meterCoveragePct ?? null,
        varianceMw: plannedMw !== null && a.actualMw !== null ? round(a.actualMw - plannedMw, 3) : null,
        variancePct: plannedMw && a.actualMw !== null ? round(((a.actualMw - plannedMw) / plannedMw) * 100, 1) : null,
        dataCoveragePct: a.dataCoveragePct ?? 0,
      };
    }
    const hours = a ? Number(a.minutes) / 60 : 0;
    const actualMw = a && hours > 0 ? Number(a.kwh) / hours / 1000 : null;
    return {
      month,
      phase: step?.phase || null,
      plannedMw: round(plannedMw, 3),
      plannedPeakMw: round(step ? num(step.plannedPeakMw) : null, 3),
      actualMw: round(actualMw, 3),
      varianceMw: plannedMw !== null && actualMw !== null ? round(actualMw - plannedMw, 3) : null,
      variancePct: plannedMw && actualMw !== null ? round(((actualMw - plannedMw) / plannedMw) * 100, 1) : null,
      // Share of the month's hours covered by readings — low coverage means a less reliable average.
      dataCoveragePct: a ? round(Math.min(100, (hours / monthHours) * 100), 1) : 0,
    };
  });
}

// ── Reserve margin ────────────────────────────────────────────────────────────

/**
 * Firm capacity versus peak load for one site.
 * Firm capacity counts ONLY values a user entered: contract firmCapacityMw
 * (active/pending contracts) and microgrid asset firmCapacityKw (active).
 * Peak load comes from the load ramp: the step in effect now, and the highest
 * planned peak at full build-out. plannedPeakMw is used when set, otherwise
 * the planned load.
 */
export function reserveMargin({ property, contracts, assets, steps, at = new Date() }) {
  const firmSources = [];
  const missingFirm = [];
  for (const c of contracts) {
    if (!CONTRACTED_STATUSES.has(c.status)) continue;
    const firm = num(c.firmCapacityMw);
    if (firm === null) missingFirm.push({ kind: "contract", id: c.id, name: c.name });
    else firmSources.push({ kind: "contract", id: c.id, name: c.name, mw: firm });
  }
  for (const a of assets) {
    if (!a.microgrid || a.status !== "ACTIVE") continue;
    const firm = num(a.firmCapacityKw);
    if (firm === null) missingFirm.push({ kind: "asset", id: a.id, name: a.name });
    else firmSources.push({ kind: "asset", id: a.id, name: a.name, mw: firm / 1000 });
  }
  const firmMw = firmSources.length ? firmSources.reduce((s, x) => s + x.mw, 0) : null;
  const peakOf = (s) => (s ? num(s.plannedPeakMw) ?? num(s.plannedLoadMw) : null);
  const currentPeak = peakOf(rampStepAt(steps, at));
  const buildoutPeak = steps.length ? Math.max(...steps.map(peakOf).filter((v) => v !== null)) : null;
  const margin = (peak) => (firmMw !== null && peak ? ((firmMw - peak) / peak) * 100 : null);
  const required = num(property?.requiredReserveMarginPct);
  const now = margin(currentPeak);
  const buildout = margin(Number.isFinite(buildoutPeak) ? buildoutPeak : null);
  const missingInputs = [];
  if (firmMw === null) missingInputs.push("firm capacity (enter firm MW on active contracts or firm kW on active microgrid resources)");
  if (currentPeak === null) missingInputs.push("current peak load (add a load ramp step in effect today)");
  if (!Number.isFinite(buildoutPeak)) missingInputs.push("planned peak at full build-out (add load ramp steps)");
  if (required === null) missingInputs.push("required reserve margin (site setting)");
  return {
    formula_version: "reserve-margin-v1",
    propertyId: property?.id ?? null,
    calculable: now !== null || buildout !== null,
    missingInputs,
    firmCapacityMw: round(firmMw, 3),
    firmSources: firmSources.map((x) => ({ ...x, mw: round(x.mw, 3) })),
    missingFirmCapacity: missingFirm,
    currentPeakMw: round(currentPeak, 3),
    buildoutPeakMw: round(Number.isFinite(buildoutPeak) ? buildoutPeak : null, 3),
    currentMarginPct: round(now, 1),
    buildoutMarginPct: round(buildout, 1),
    requiredMarginPct: required,
    meetsRequirementNow: required !== null && now !== null ? now >= required : null,
    meetsRequirementAtBuildout: required !== null && buildout !== null ? buildout >= required : null,
    // Additional firm MW needed to hold the required margin at full build-out.
    buildoutFirmGapMw: required !== null && Number.isFinite(buildoutPeak) && buildoutPeak
      ? round(Math.max(0, buildoutPeak * (1 + required / 100) - (firmMw ?? 0)), 3)
      : null,
  };
}

// ── Cost allocation ───────────────────────────────────────────────────────────

/** Customer vs ratepayer cost split. Only entered amounts are summed. */
export function costAllocationSummary(rows) {
  const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const total = sum("totalCost"), customer = sum("customerShare"), ratepayer = sum("ratepayerShare"), other = sum("otherShare");
  const allocated = customer + ratepayer + other;
  const byCategory = {};
  for (const r of rows) {
    const c = (byCategory[r.category] ||= { category: r.category, items: 0, totalCost: 0, customerShare: 0, ratepayerShare: 0, otherShare: 0 });
    c.items += 1;
    for (const k of ["totalCost", "customerShare", "ratepayerShare", "otherShare"]) c[k] += Number(r[k]) || 0;
  }
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + (Number(r.totalCost) || 0);
  return {
    items: rows.length,
    totalCost: rows.length ? round(total) : null,
    customerShare: rows.length ? round(customer) : null,
    ratepayerShare: rows.length ? round(ratepayer) : null,
    otherShare: rows.length ? round(other) : null,
    unallocated: rows.length ? round(Math.max(0, total - allocated)) : null,
    customerSharePct: allocated ? round((customer / allocated) * 100, 1) : null,
    ratepayerSharePct: allocated ? round((ratepayer / allocated) * 100, 1) : null,
    byCategory: Object.values(byCategory).map((c) => ({ ...c, totalCost: round(c.totalCost), customerShare: round(c.customerShare), ratepayerShare: round(c.ratepayerShare), otherShare: round(c.otherShare) })),
    byStatus: Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k, round(v)])),
  };
}

// ── Water: direct + upstream ──────────────────────────────────────────────────

/**
 * Upstream (generation) water = delivered MWh × water intensity, for contracts
 * that have both, plus grid MWh × the site's grid water intensity. Energy with
 * no intensity entered is reported as uncovered, never assumed.
 * gridKwhByProperty: { [propertyId]: kWh } from readings.
 */
export function upstreamWater({ contracts, performance, properties, gridKwhByProperty }) {
  const perf = new Map((performance?.contracts || []).map((r) => [r.contractId, r]));
  const components = [];
  let coveredMwh = 0, uncoveredMwh = 0, gallons = 0;
  for (const c of contracts) {
    const p = perf.get(c.id);
    if (!p || p.deliveredMwh === null) continue;
    const intensity = num(c.waterIntensityGalPerMwh);
    if (intensity === null) { uncoveredMwh += p.deliveredMwh; continue; }
    const g = p.deliveredMwh * intensity;
    gallons += g; coveredMwh += p.deliveredMwh;
    components.push({ kind: "contract", id: c.id, name: c.name, resourceType: c.resourceType, mwh: p.deliveredMwh, galPerMwh: intensity, gallons: round(g), source: c.waterIntensitySource || null });
  }
  for (const prop of properties) {
    const kwh = num(gridKwhByProperty?.[prop.id]);
    if (kwh === null || kwh === 0) continue;
    const mwh = kwh / 1000;
    const intensity = num(prop.gridWaterIntensityGalPerMwh);
    if (intensity === null) { uncoveredMwh += mwh; continue; }
    const g = mwh * intensity;
    gallons += g; coveredMwh += mwh;
    components.push({ kind: "grid", id: prop.id, name: `${prop.name} grid supply`, resourceType: "GRID_MIX", mwh: round(mwh), galPerMwh: intensity, gallons: round(g), source: prop.gridWaterIntensitySource || null });
  }
  return {
    upstreamGallons: components.length ? round(gallons) : null,
    coveredMwh: round(coveredMwh),
    uncoveredMwh: round(uncoveredMwh),
    coveragePct: coveredMwh + uncoveredMwh > 0 ? round((coveredMwh / (coveredMwh + uncoveredMwh)) * 100, 1) : null,
    components,
  };
}

// ── Permits & regulatory milestones ───────────────────────────────────────────
export const MILESTONE_CLOSED = Object.freeze(["APPROVED", "DENIED", "WITHDRAWN", "EXPIRED"]);

export function milestoneSummary(milestones, { at = new Date(), horizonDays = 90 } = {}) {
  const now = toDate(at).getTime();
  const horizon = now + horizonDays * 24 * MS_PER_HOUR;
  const open = milestones.filter((m) => !MILESTONE_CLOSED.includes(m.status));
  const due = (m) => (m.dueDate ? toDate(m.dueDate).getTime() : null);
  const exp = (m) => (m.expiresAt ? toDate(m.expiresAt).getTime() : null);
  const byStatus = {};
  for (const m of milestones) byStatus[m.status] = (byStatus[m.status] || 0) + 1;
  const pick = (m) => ({ id: m.id, title: m.title, category: m.category, status: m.status, dueDate: m.dueDate || null, expiresAt: m.expiresAt || null, propertyId: m.propertyId || null });
  return {
    total: milestones.length,
    open: open.length,
    byStatus,
    overdue: open.filter((m) => due(m) !== null && due(m) < now).map(pick),
    upcoming: open.filter((m) => due(m) !== null && due(m) >= now && due(m) <= horizon).sort((a, b) => due(a) - due(b)).map(pick),
    // Approved permits/approvals that lapse soon.
    expiringSoon: milestones.filter((m) => m.status === "APPROVED" && exp(m) !== null && exp(m) >= now && exp(m) <= horizon).map(pick),
  };
}

/** Whether a milestone is past due (open with a due date in the past). */
export function isOverdue(m, at = new Date()) {
  return !MILESTONE_CLOSED.includes(m.status) && !!m.dueDate && toDate(m.dueDate) < toDate(at);
}
