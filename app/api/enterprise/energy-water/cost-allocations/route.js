/**
 * GET  /api/enterprise/energy-water/cost-allocations — Viewer+ (?propertyId= filter)
 * POST /api/enterprise/energy-water/cost-allocations — Manager+
 * Customer-versus-ratepayer cost allocation.
 */
import { makeCollectionHandlers } from "@/lib/energy-water-crud.js";
import { COST_ALLOCATIONS } from "@/lib/energy-water-resources.js";

export const { GET, POST } = makeCollectionHandlers(COST_ALLOCATIONS);
