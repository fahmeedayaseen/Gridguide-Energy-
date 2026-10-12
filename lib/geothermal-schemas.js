/**
 * Validation for the Enterprise Energy & Water (geothermal) module.
 * Kept out of the route files: Next.js route modules should only export
 * HTTP handlers.
 */
import { z } from "zod";
import { MEASUREMENT_FIELDS, SIGNED_FIELDS } from "./geothermal-metrics.mjs";

export const ASSET_TYPES = [
  // generation
  "GEOTHERMAL_GENERATION", "SOLAR", "WIND", "HYDRO", "NUCLEAR", "GAS_TURBINE", "RECIPROCATING_ENGINE", "FUEL_CELL", "DIESEL_GENERATOR",
  // storage & backup
  "BATTERY", "THERMAL_STORAGE", "UPS",
  // site systems
  "GROUND_SOURCE_HEAT_PUMP", "CHILLER", "GRID_CONNECTION",
];
export const RESOURCE_TYPE_KEYS = ["GEOTHERMAL", "SOLAR", "WIND", "HYDRO", "NUCLEAR", "GAS", "DIESEL", "STORAGE", "GRID_MIX", "OTHER"];
export const CONTRACT_TYPES = ["PPA", "VIRTUAL_PPA", "UTILITY_TARIFF", "SLEEVED", "CAPACITY", "RESERVE", "TOLLING", "BEHIND_THE_METER", "OTHER"];
export const ASSET_STATUSES = ["PLANNED", "CONSTRUCTION", "ACTIVE", "INACTIVE", "RETIRED"];
export const COOLING_TYPES = ["AIR", "WATER", "HYBRID", "CLOSED_LOOP", "GROUND_SOURCE", "OTHER"];
export const WATER_SOURCES = ["MUNICIPAL", "RECLAIMED", "GROUNDWATER", "SURFACE", "CLOSED_LOOP", "NONE", "OTHER"];
export const PPA_STATUSES = ["PROPOSED", "PENDING_APPROVAL", "ACTIVE", "EXPIRED", "TERMINATED"];
export const REGULATORY_APPROVALS = ["NOT_REQUIRED", "PENDING", "APPROVED", "REJECTED"];
export const READING_SOURCES = ["MANUAL", "CSV", "API", "METER", "DCIM", "BMS"];

// Empty strings from HTML forms mean "not provided".
const blankToNull = (v) => (v === "" ? null : v);
const optText = (max) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const optNumber = (schema) => z.preprocess(blankToNull, schema.nullable().optional());
const optDate = z.preprocess(blankToNull, z.string().datetime({ offset: true }).nullable().optional());
const optId = z.preprocess(blankToNull, z.string().min(1).max(64).nullable().optional());
// HTML forms send "true"/"false"; z.coerce.boolean() would turn "false" into true.
const formBool = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());

// ── Assets ────────────────────────────────────────────────────────────────────
const assetFields = {
  propertyId: optId,
  name: z.string().trim().min(1).max(150),
  type: z.enum(ASSET_TYPES),
  status: z.enum(ASSET_STATUSES),
  provider: optText(150),
  externalId: optText(150),
  ratedCapacityKw: optNumber(z.coerce.number().nonnegative()),
  thermalCapacityKwh: optNumber(z.coerce.number().nonnegative()),
  coolingType: z.preprocess(blankToNull, z.enum(COOLING_TYPES).nullable().optional()),
  waterSource: z.preprocess(blankToNull, z.enum(WATER_SOURCES).nullable().optional()),
  commercialOperationAt: optDate,
  microgrid: formBool,
  firmCapacityKw: optNumber(z.coerce.number().nonnegative().max(1e9)),
};

export const assetCreateSchema = z.object({ ...assetFields, status: assetFields.status.default("PLANNED"), microgrid: assetFields.microgrid.default(false) }).strict();
export const assetUpdateSchema = z.object(assetFields).partial().strict()
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

// ── PPAs ──────────────────────────────────────────────────────────────────────
const ppaFields = {
  propertyId: optId,
  assetId: optId,
  name: z.string().trim().min(1).max(150),
  seller: z.string().trim().min(1).max(150),
  utility: optText(150),
  status: z.enum(PPA_STATUSES),
  resourceType: z.enum(RESOURCE_TYPE_KEYS),
  contractType: z.enum(CONTRACT_TYPES),
  contractedMw: z.coerce.number().positive().max(100000),
  contractedAnnualMwh: optNumber(z.coerce.number().nonnegative().max(1e9)),
  firmCapacityMw: optNumber(z.coerce.number().nonnegative().max(100000)),
  waterIntensityGalPerMwh: optNumber(z.coerce.number().nonnegative().max(1e6)),
  waterIntensitySource: optText(300),
  evidenceReference: optText(500),
  termYears: z.coerce.number().int().min(1).max(100),
  capacityFactorPct: z.coerce.number().min(1).max(100),
  pricePerMwh: optNumber(z.coerce.number().nonnegative().max(100000)),
  annualEscalationPct: optNumber(z.coerce.number().min(-20).max(50)),
  signedAt: optDate,
  deliveryStartAt: optDate,
  deliveryEndAt: optDate,
  regulatoryApproval: z.preprocess(blankToNull, z.enum(REGULATORY_APPROVALS).nullable().optional()),
  notes: optText(4000),
};

const deliveryWindowOk = (d) =>
  !(d.deliveryStartAt && d.deliveryEndAt) || new Date(d.deliveryEndAt) >= new Date(d.deliveryStartAt);
const deliveryWindowMsg = { message: "Delivery end must be on or after delivery start", path: ["deliveryEndAt"] };

export const ppaCreateSchema = z.object({
  ...ppaFields,
  status: ppaFields.status.default("PROPOSED"),
  resourceType: ppaFields.resourceType.default("GEOTHERMAL"),
  contractType: ppaFields.contractType.default("PPA"),
  capacityFactorPct: ppaFields.capacityFactorPct.default(90),
}).strict().refine(deliveryWindowOk, deliveryWindowMsg);

export const ppaUpdateSchema = z.object(ppaFields).partial().strict()
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" })
  .refine(deliveryWindowOk, deliveryWindowMsg);

// ── Readings ──────────────────────────────────────────────────────────────────
// Each measurement is optional and nullable: blank means "not measured",
// never zero. A reading must report at least one measurement.
// Storage change is signed (filling + / draining −); every other measurement is ≥ 0.
const measurementFields = Object.fromEntries(
  MEASUREMENT_FIELDS.map((f) => [f, optNumber(SIGNED_FIELDS.includes(f)
    ? z.coerce.number().min(-1e12).max(1e12)
    : z.coerce.number().nonnegative().max(1e12))])
);

// Water volumes may be sent in gallons (default), litres or cubic metres; they
// are normalized to gallons on ingest and the original unit is kept as provenance.
export const WATER_UNITS = { gal: 1, L: 1 / 3.785411784, m3: 1000 / 3.785411784 };
export const WATER_FIELDS = MEASUREMENT_FIELDS.filter((f) => f.startsWith("water") || f === "baselineWaterConsumedGallons");

/** Convert a validated reading's water fields to gallons and record the input unit. */
export function normalizeWaterUnits(row) {
  const unit = row.waterUnit || "gal";
  const factor = WATER_UNITS[unit];
  const { waterUnit, ...rest } = row;
  if (unit === "gal") return { ...rest, metadata: { ...(rest.metadata || {}), provenance: { waterInputUnit: "gal" } } };
  const out = { ...rest };
  for (const f of WATER_FIELDS) if (out[f] !== null && out[f] !== undefined) out[f] = Math.round(out[f] * factor * 1e6) / 1e6;
  out.metadata = { ...(rest.metadata || {}), provenance: { waterInputUnit: unit, factorToGallons: factor } };
  return out;
}

const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
const recordedAt = z.string().datetime({ offset: true })
  .refine((v) => new Date(v).getTime() <= Date.now() + MAX_FUTURE_MS, { message: "recordedAt can't be in the future" });

const hasMeasurement = (d) => MEASUREMENT_FIELDS.some((f) => d[f] !== null && d[f] !== undefined);
const hasMeasurementMsg = { message: "A reading must include at least one measurement" };

export const readingCreateSchema = z.object({
  propertyId: z.string().min(1).max(64),
  assetId: optId,
  recordedAt,
  intervalMinutes: z.coerce.number().int().min(1).max(44640).default(60),
  meterId: optId,
  ...measurementFields,
  waterUnit: z.enum(Object.keys(WATER_UNITS)).optional(),
  source: z.enum(READING_SOURCES).default("MANUAL"),
  externalId: optText(200),
}).strict().refine(hasMeasurement, hasMeasurementMsg);

export const readingUpdateSchema = z.object({
  propertyId: z.string().min(1).max(64),
  assetId: optId,
  recordedAt,
  intervalMinutes: z.coerce.number().int().min(1).max(44640),
  meterId: optId,
  ...measurementFields,
}).partial().strict()
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const MAX_READINGS_PER_REQUEST = 500;

/**
 * Validate a readings POST body (one reading or { readings: [...] }) row by
 * row, so errors name the failing row instead of one opaque union error.
 */
export function validateReadingsBody(body) {
  const isBatch = body && typeof body === "object" && Array.isArray(body.readings);
  if (isBatch && Object.keys(body).some((k) => k !== "readings")) {
    return { rows: null, errors: [{ row: null, issues: ["Batch body must contain only a readings array"] }] };
  }
  const input = isBatch ? body.readings : [body];
  if (input.length === 0) return { rows: null, errors: [{ row: null, issues: ["readings is empty"] }] };
  if (input.length > MAX_READINGS_PER_REQUEST) {
    return { rows: null, errors: [{ row: null, issues: [`At most ${MAX_READINGS_PER_REQUEST} readings per request`] }] };
  }
  const rows = [];
  const errors = [];
  input.forEach((raw, i) => {
    const parsed = readingCreateSchema.safeParse(raw);
    if (parsed.success) rows.push(normalizeWaterUnits(parsed.data));
    else errors.push({ row: i + 1, issues: parsed.error.issues.map((iss) => `${iss.path.join(".") || "reading"}: ${iss.message}`) });
  });
  return { rows: errors.length ? null : rows, errors };
}

/** Normalize a validated payload's ISO date strings to Date objects (null stays null). */
export function toDates(data, fields) {
  const out = { ...data };
  for (const f of fields) {
    if (out[f] !== undefined) out[f] = out[f] ? new Date(out[f]) : null;
  }
  return out;
}
