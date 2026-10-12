/**
 * PATCH  /api/enterprise/energy-water/milestones/:id — Manager+
 * DELETE /api/enterprise/energy-water/milestones/:id — Manager+
 */
import { makeItemHandlers } from "@/lib/energy-water-crud.js";
import { MILESTONES } from "@/lib/energy-water-resources.js";

export const { PATCH, DELETE } = makeItemHandlers(MILESTONES);
