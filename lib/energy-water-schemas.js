/**
 * Validation for the Energy & Water accountability records: load ramp,
 * regulatory milestones, cost allocation, contract deliveries and site
 * settings. Route files import from here (they export handlers only).
 */
import { z } from "zod";

export const RAMP_PHASES = ["CONSTRUCTION", "COMMISSIONING", "PARTIAL_OPERATION", "RAMP", "PEAK_OPERATION", "OTHER"];
export const MILESTONE_CATEGORIES = ["PERMIT", "REGULATORY_FILING", "RATE_CASE", "INTERCONNECTION", "TRANSMISSION", "ENVIRONMENTAL", "WATER_RIGHTS", "ZONING", "OTHER"];
export const MILESTONE_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "FILED", "APPROVED", "DENIED", "WITHDRAWN", "EXPIRED"];
export const COST_CATEGORIES = ["GENERATION", "TRANSMISSION", "DISTRIBUTION", "INTERCONNECTION", "CAPACITY", "RESERVE", "WATER_INFRASTRUCTURE", "STRANDED_COST_PROTECTION", "OTHER"];
export const COST_BASES = ["TARIFF", "CONTRACT", "COMMISSION_ORDER", "SETTLEMENT", "ESTIMATE"];
export const COST_STATUSES = ["ESTIMATED", "PROPOSED", "APPROVED", "ACTUAL"];
export const DELIVERY_SOURCES = ["MANUAL", "CSV", "API", "SETTLEMENT", "METER"];

const blankToNull = (v) => (v === "" ? null : v);
const optText = (max) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const optNumber = (schema) => z.preprocess(blankToNull, schema.nullable().optional());
const isoDate = z.string().datetime({ offset: true });
const optDate = z.preprocess(blankToNull, isoDate.nullable().optional());
const optId = z.preprocess(blankToNull, z.string().min(1).max(64).nullable().optional());
const money = z.coerce.number().nonnegative().max(1e13);
const noEmptyUpdate = { message: "No fields to update" };
const nonEmpty = (d) => Object.keys(d).length > 0;

// ── Load ramp ─────────────────────────────────────────────────────────────────
const rampFields = {
  propertyId: z.string().min(1).max(64),
  effectiveDate: isoDate,
  phase: z.enum(RAMP_PHASES),
  plannedLoadMw: z.coerce.number().nonnegative().max(100000),
  plannedPeakMw: optNumber(z.coerce.number().nonnegative().max(100000)),
  notes: optText(2000),
};
export const rampStepCreateSchema = z.object(rampFields).strict();
export const rampStepUpdateSchema = z.object(rampFields).partial().strict().refine(nonEmpty, noEmptyUpdate);

// ── Regulatory milestones ─────────────────────────────────────────────────────
const milestoneFields = {
  propertyId: optId,
  contractId: optId,
  assetId: optId,
  category: z.enum(MILESTONE_CATEGORIES),
  title: z.string().trim().min(1).max(200),
  agency: optText(200),
  docketNumber: optText(100),
  status: z.enum(MILESTONE_STATUSES),
  dueDate: optDate,
  filedAt: optDate,
  decidedAt: optDate,
  expiresAt: optDate,
  referenceUrl: z.preprocess(blankToNull, z.string().url().max(1000).refine((u) => /^https?:\/\//i.test(u), { message: "Must be an http(s) link" }).nullable().optional()),
  notes: optText(4000),
};
export const milestoneCreateSchema = z.object({ ...milestoneFields, status: milestoneFields.status.default("NOT_STARTED") }).strict();
export const milestoneUpdateSchema = z.object(milestoneFields).partial().strict().refine(nonEmpty, noEmptyUpdate);

// ── Cost allocation ───────────────────────────────────────────────────────────
const costFields = {
  propertyId: optId,
  contractId: optId,
  category: z.enum(COST_CATEGORIES),
  description: z.string().trim().min(1).max(300),
  totalCost: money,
  customerShare: money,
  ratepayerShare: money,
  otherShare: money,
  basis: z.enum(COST_BASES),
  status: z.enum(COST_STATUSES),
  sourceReference: optText(300),
  periodStart: optDate,
  periodEnd: optDate,
  notes: optText(4000),
};
// Shares can't add up to more than the total (a cent of rounding is allowed).
export const sharesWithinTotal = (d) =>
  (Number(d.customerShare) || 0) + (Number(d.ratepayerShare) || 0) + (Number(d.otherShare) || 0) <= (Number(d.totalCost) || 0) + 0.01;
export const SHARES_MSG = { message: "Customer, ratepayer and other shares can't exceed the total cost", path: ["totalCost"] };
const periodOk = (d) => !(d.periodStart && d.periodEnd) || new Date(d.periodEnd) >= new Date(d.periodStart);
const PERIOD_MSG = { message: "Period end must be on or after period start", path: ["periodEnd"] };

export const costCreateSchema = z.object({
  ...costFields,
  otherShare: costFields.otherShare.default(0),
  basis: costFields.basis.default("CONTRACT"),
  status: costFields.status.default("ESTIMATED"),
}).strict().refine(sharesWithinTotal, SHARES_MSG).refine(periodOk, PERIOD_MSG);
export const costUpdateSchema = z.object(costFields).partial().strict().refine(nonEmpty, noEmptyUpdate);

// ── Contract deliveries ───────────────────────────────────────────────────────
const deliveryFields = {
  contractId: z.string().min(1).max(64),
  periodStart: isoDate,
  periodEnd: isoDate,
  deliveredMwh: z.coerce.number().nonnegative().max(1e9),
  peakDeliveredMw: optNumber(z.coerce.number().nonnegative().max(100000)),
  curtailedMwh: optNumber(z.coerce.number().nonnegative().max(1e9)),
  source: z.enum(DELIVERY_SOURCES),
  externalId: optText(200),
  notes: optText(2000),
};
const deliveryPeriodOk = (d) => !(d.periodStart && d.periodEnd) || new Date(d.periodEnd) > new Date(d.periodStart);
const DELIVERY_PERIOD_MSG = { message: "periodEnd must be after periodStart (periodEnd is exclusive)", path: ["periodEnd"] };
const MAX_PERIOD_MS = 400 * 24 * 3600 * 1000;
const deliveryPeriodLen = (d) => !(d.periodStart && d.periodEnd) || new Date(d.periodEnd) - new Date(d.periodStart) <= MAX_PERIOD_MS;

export const deliveryCreateSchema = z.object({ ...deliveryFields, source: deliveryFields.source.default("MANUAL") })
  .strict().refine(deliveryPeriodOk, DELIVERY_PERIOD_MSG).refine(deliveryPeriodLen, { message: "A delivery period can be at most 400 days", path: ["periodEnd"] });
export const deliveryUpdateSchema = z.object({
  periodStart: deliveryFields.periodStart,
  periodEnd: deliveryFields.periodEnd,
  deliveredMwh: deliveryFields.deliveredMwh,
  peakDeliveredMw: deliveryFields.peakDeliveredMw,
  curtailedMwh: deliveryFields.curtailedMwh,
  notes: deliveryFields.notes,
}).partial().strict().refine(nonEmpty, noEmptyUpdate);

export const MAX_DELIVERIES_PER_REQUEST = 500;
export function validateDeliveriesBody(body) {
  const isBatch = body && typeof body === "object" && Array.isArray(body.deliveries);
  const input = isBatch ? body.deliveries : [body];
  if (!input.length) return { rows: null, errors: [{ row: null, issues: ["deliveries is empty"] }] };
  if (input.length > MAX_DELIVERIES_PER_REQUEST) return { rows: null, errors: [{ row: null, issues: [`At most ${MAX_DELIVERIES_PER_REQUEST} deliveries per request`] }] };
  const rows = [], errors = [];
  input.forEach((raw, i) => {
    const r = deliveryCreateSchema.safeParse(raw);
    if (r.success) rows.push(r.data);
    else errors.push({ row: i + 1, issues: r.error.issues.map((x) => `${x.path.join(".") || "delivery"}: ${x.message}`) });
  });
  return { rows: errors.length ? null : rows, errors };
}

// ── Site settings (data-center planning) ──────────────────────────────────────
export const propertySettingsSchema = z.object({
  requiredReserveMarginPct: optNumber(z.coerce.number().min(0).max(500)),
  gridWaterIntensityGalPerMwh: optNumber(z.coerce.number().nonnegative().max(1e6)),
  gridWaterIntensitySource: optText(300),
}).strict().refine(nonEmpty, noEmptyUpdate);
