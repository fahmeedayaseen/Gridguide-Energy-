/**
 * GET /api/rates/public
 * Read-only subset of platform rates for authenticated installer and enterprise portals.
 * Requires a valid session of any role — NOT admin-only, but NOT public either.
 */
import { ok, err }                from "@/lib/auth.js";
import { authenticateRequest }    from "@/lib/jwt.js";
import { getPlatformConfig }      from "@/lib/platform-config.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status ?? 401);

  const cfg = await getPlatformConfig();

  return ok({
    subscription: {
      plusMonthly:  cfg.plusMonthly  ?? 9.99,
      plusAnnual:   cfg.plusAnnual   ?? 8.29,
      proMonthly:   cfg.proMonthly   ?? 19.99,
      proAnnual:    cfg.proAnnual    ?? 16.59,
      pctPlus:      Math.round((cfg.pctPlus   ?? 0.70) * 100),
      pctAnnual:    Math.round((cfg.pctAnnual ?? 0.30) * 100),
    },
    installer: {
      revenueShare: {
        free:       { pct: cfg.installerShareFree       ?? 0.15 },
        pro:        { pct: cfg.installerSharePro        ?? 0.25 },
        enterprise: { pct: cfg.installerShareEnterprise ?? 0.30 },
      },
      leadSuccessFees: {
        free:       { pct: cfg.leadSuccessFeeFree       ?? 0.10 },
        pro:        { pct: cfg.leadSuccessFeePro        ?? 0.07 },
        enterprise: { pct: cfg.leadSuccessFeeEnterprise ?? 0.05 },
      },
    },
  });
}
