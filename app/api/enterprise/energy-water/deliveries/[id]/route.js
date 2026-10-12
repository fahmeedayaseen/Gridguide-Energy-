/**
 * PATCH  /api/enterprise/energy-water/deliveries/:id — Manager+
 * DELETE /api/enterprise/energy-water/deliveries/:id — Manager+
 */
import { makeItemHandlers } from "@/lib/energy-water-crud.js";
import { deliveryUpdateSchema } from "@/lib/energy-water-schemas.js";

export const { PATCH, DELETE } = makeItemHandlers({
  model: "enterpriseContractDelivery",
  label: "Delivery",
  auditTarget: "EnterpriseContractDelivery",
  auditAction: "CONTRACT_DELIVERY",
  auditCategory: "OTHER",
  updateSchema: deliveryUpdateSchema,
  dateFields: ["periodStart", "periodEnd"],
  include: { contract: { select: { id: true, name: true, resourceType: true, contractedMw: true } } },
  validateMerged: (m) => (new Date(m.periodEnd) > new Date(m.periodStart) ? null : "periodEnd must be after periodStart"),
  auditMeta: (r) => ({ contractId: r.contractId, periodStart: r.periodStart, deliveredMwh: r.deliveredMwh }),
});
