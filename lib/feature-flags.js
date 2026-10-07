/**
 * Feature flags for phased rollout / rollback of legacy subsystems.
 *
 * ENABLE_LEGACY_VPP_DISPATCH
 * ---------------------------------------------------------------------------
 * Gates GridGuide's original VPP subsystem, in which an admin manually typed
 * in a utility payment amount and clicked "Dispatch" — implying GridGuide
 * itself operates/dispatches VPP events. That is no longer how the product
 * is positioned: GridGuide tracks and settles VPP participation through
 * partner integrations (Leap, Enel, and future providers), it does not
 * operate events itself unless a certified device/operator integration
 * exists in the future.
 *
 * This flag exists ONLY for temporary rollback / historical data access
 * during the transition. It must default to false, in every environment,
 * unless explicitly set. Do not flip this on in production.
 *
 * Gated by this flag:
 *   - POST/GET /api/vpp/events            (legacy VppEvent create/list)
 *   - POST /api/vpp/events/[id]/dispatch   (legacy manual dispatch)
 *   - GET/POST /api/vpp/payouts            (legacy manual batch payout)
 *   - GET/POST/PATCH/DELETE /api/admin/vpp-revenue-rules[/id] (only consumed
 *     by the legacy payouts path above)
 *   - GET/POST/DELETE /api/vpp/enrollment  (legacy VppEnrollment, singular)
 *
 * NOT gated (these are the real, current system and stay on):
 *   - /api/vpp/providers
 *   - /api/vpp/enrollments (plural — partner-based)
 *   - /api/vpp/events/partner
 *   - /api/vpp/webhooks/[provider]
 *   - /api/vpp/revenue
 */
export function isLegacyVppDispatchEnabled() {
  return process.env.ENABLE_LEGACY_VPP_DISPATCH === "true";
}
