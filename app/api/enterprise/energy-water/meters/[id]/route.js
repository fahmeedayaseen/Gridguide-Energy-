/**
 * PATCH  /api/enterprise/energy-water/meters/:id — Manager+
 * DELETE /api/enterprise/energy-water/meters/:id — Manager+ (refused while it has readings or sub-meters)
 */
import { updateMeter, deleteMeter } from "@/lib/energy-water-meter-routes.js";

export const PATCH = updateMeter;
export const DELETE = deleteMeter;
