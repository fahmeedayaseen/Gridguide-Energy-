/**
 * GET  /api/enterprise/energy-water/meters?propertyId= — Viewer+
 * POST /api/enterprise/energy-water/meters — Manager+
 * Meter hierarchy for actual site load: level, parent, coverage, effective
 * dates, settlement priority, preferred settlement meter.
 */
import { listMeters, createMeter } from "@/lib/energy-water-meter-routes.js";

export const GET = listMeters;
export const POST = createMeter;
