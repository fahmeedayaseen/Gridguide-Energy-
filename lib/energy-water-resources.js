/**
 * Route configurations for the Energy & Water records handled by
 * lib/energy-water-crud.js. One config per record type, shared by the
 * collection route and the item route.
 */
import {
  rampStepCreateSchema, rampStepUpdateSchema,
  milestoneCreateSchema, milestoneUpdateSchema,
  costCreateSchema, costUpdateSchema, sharesWithinTotal,
} from "./energy-water-schemas.js";

const property = { select: { id: true, name: true } };

export const RAMP_STEPS = {
  model: "enterpriseLoadRampStep",
  label: "Load ramp step",
  auditTarget: "EnterpriseLoadRampStep",
  auditAction: "LOAD_RAMP_STEP",
  auditCategory: "OTHER",
  createSchema: rampStepCreateSchema,
  updateSchema: rampStepUpdateSchema,
  dateFields: ["effectiveDate"],
  include: { property },
  orderBy: [{ propertyId: "asc" }, { effectiveDate: "asc" }],
  auditMeta: (r) => ({ propertyId: r.propertyId, phase: r.phase, effectiveDate: r.effectiveDate, plannedLoadMw: r.plannedLoadMw }),
};

export const MILESTONES = {
  model: "enterpriseRegulatoryMilestone",
  label: "Milestone",
  auditTarget: "EnterpriseRegulatoryMilestone",
  auditAction: "REGULATORY_MILESTONE",
  auditCategory: "OTHER",
  createSchema: milestoneCreateSchema,
  updateSchema: milestoneUpdateSchema,
  dateFields: ["dueDate", "filedAt", "decidedAt", "expiresAt"],
  include: { property, contract: { select: { id: true, name: true } }, asset: { select: { id: true, name: true } } },
  orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  filters: (p) => ({
    ...(p.get("status") && { status: p.get("status") }),
    ...(p.get("category") && { category: p.get("category") }),
  }),
  auditMeta: (r) => ({ title: r.title, category: r.category, status: r.status }),
};

export const COST_ALLOCATIONS = {
  model: "enterpriseCostAllocation",
  label: "Cost allocation",
  auditTarget: "EnterpriseCostAllocation",
  auditAction: "COST_ALLOCATION",
  auditCategory: "BILLING",
  createSchema: costCreateSchema,
  updateSchema: costUpdateSchema,
  dateFields: ["periodStart", "periodEnd"],
  include: { property, contract: { select: { id: true, name: true } } },
  orderBy: [{ createdAt: "desc" }],
  validateMerged: (m) => {
    if (!sharesWithinTotal(m)) return "Customer, ratepayer and other shares can't exceed the total cost";
    if (m.periodStart && m.periodEnd && new Date(m.periodEnd) < new Date(m.periodStart)) return "Period end must be on or after period start";
    return null;
  },
  auditMeta: (r) => ({ category: r.category, totalCost: r.totalCost, customerShare: r.customerShare, ratepayerShare: r.ratepayerShare }),
};
