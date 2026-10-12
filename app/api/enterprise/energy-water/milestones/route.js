/**
 * GET  /api/enterprise/energy-water/milestones — Viewer+ (?propertyId= filter)
 * POST /api/enterprise/energy-water/milestones — Manager+
 * Permits, regulatory filings, interconnection and transmission approvals.
 */
import { makeCollectionHandlers } from "@/lib/energy-water-crud.js";
import { MILESTONES } from "@/lib/energy-water-resources.js";

export const { GET, POST } = makeCollectionHandlers(MILESTONES);
