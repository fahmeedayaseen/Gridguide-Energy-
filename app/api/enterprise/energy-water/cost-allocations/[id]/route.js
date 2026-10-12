/**
 * PATCH  /api/enterprise/energy-water/cost-allocations/:id — Manager+
 * DELETE /api/enterprise/energy-water/cost-allocations/:id — Manager+
 */
import { makeItemHandlers } from "@/lib/energy-water-crud.js";
import { COST_ALLOCATIONS } from "@/lib/energy-water-resources.js";

export const { PATCH, DELETE } = makeItemHandlers(COST_ALLOCATIONS);
