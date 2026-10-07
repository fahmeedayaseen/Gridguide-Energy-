import { err } from "@/lib/auth.js";
import { isLegacyVppDispatchEnabled } from "@/lib/feature-flags.js";

/**
 * Call at the top of any legacy direct-dispatch VPP route handler.
 * Returns a 410 response if the legacy flow is disabled (the default),
 * or null if the caller should proceed as normal.
 *
 * 410 Gone (not 404) is intentional: the endpoint existed and is being
 * deliberately retired, not missing.
 */
export function legacyVppGateOrNull() {
  if (isLegacyVppDispatchEnabled()) return null;
  return err(
    "This endpoint belonged to GridGuide's legacy direct-dispatch VPP flow, which has been retired. " +
    "GridGuide tracks and settles VPP participation through partner integrations instead — see " +
    "/api/vpp/providers, /api/vpp/enrollments, /api/vpp/events/partner, and /api/vpp/revenue. " +
    "Set ENABLE_LEGACY_VPP_DISPATCH=true to temporarily re-enable this endpoint for rollback or " +
    "historical-data purposes only.",
    410
  );
}
