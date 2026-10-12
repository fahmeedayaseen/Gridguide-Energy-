/**
 * GET  /api/enterprise/energy-water/ramp-steps — Viewer+ (?propertyId= filter)
 * POST /api/enterprise/energy-water/ramp-steps — Manager+
 * Load ramp schedule (planned load from construction through peak operation).
 */
import { makeCollectionHandlers } from "@/lib/energy-water-crud.js";
import { RAMP_STEPS } from "@/lib/energy-water-resources.js";

export const { GET, POST } = makeCollectionHandlers(RAMP_STEPS);
