/**
 * PATCH  /api/enterprise/energy-water/ramp-steps/:id — Manager+
 * DELETE /api/enterprise/energy-water/ramp-steps/:id — Manager+
 */
import { makeItemHandlers } from "@/lib/energy-water-crud.js";
import { RAMP_STEPS } from "@/lib/energy-water-resources.js";

export const { PATCH, DELETE } = makeItemHandlers(RAMP_STEPS);
