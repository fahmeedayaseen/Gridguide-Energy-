import { ok, err } from "@/lib/auth.js";
import { logger, alertCritical } from "@/lib/sentry.js";
import { requireSecret, IS_PROD } from "@/lib/secrets.js";
import {
  processBiweeklySellerPayouts,
  thermostatAiOptimizer,
  syncDeviceTelemetry,
  sendWeeklyDigests,
  updateVppEventStatuses,
} from "@/lib/cron.js";

// Verify the request is from Vercel Cron or an authorized internal call.
// In production, a missing CRON_SECRET means every request is rejected —
// this endpoint triggers real financial jobs (seller payouts, commission
// runs) and must never fall back to "no auth required".
function verifyCronSecret(request) {
  let secret;
  try {
    secret = requireSecret("CRON_SECRET");
  } catch (e) {
    logger.error(`[Cron] ${e.message}`);
    return false;
  }
  if (!secret) return !IS_PROD; // only reachable in development
  const authHeader = request.headers.get("Authorization");
  return authHeader === `Bearer ${secret}`;
}

/**
 * POST /api/cron?job=seller-payouts|thermostat-ai|device-sync|weekly-digest|vpp-status
 * 
 * Called by Vercel Cron (see vercel.json) or manually by admin.
 * Protected by CRON_SECRET environment variable.
 */
export async function POST(request) {
  if (!verifyCronSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const job = searchParams.get("job");

  logger.info(`[Cron] Running job: ${job}`);
  const start = Date.now();

  try {
    let result;

    switch (job) {
      case "seller-payouts":
        result = await processBiweeklySellerPayouts();
        break;

      case "thermostat-ai":
        result = await thermostatAiOptimizer();
        break;

      case "device-sync":
        result = await syncDeviceTelemetry();
        break;

      case "weekly-digest":
        result = await sendWeeklyDigests();
        break;

      case "vpp-status":
        result = await updateVppEventStatuses();
        break;

      case "all": {
        // Run all non-heavy jobs on a single trigger
        const [vpp, devices, thermo] = await Promise.all([
          updateVppEventStatuses(),
          syncDeviceTelemetry(),
          thermostatAiOptimizer(),
        ]);
        result = { vpp, devices, thermo };
        break;
      }

      default:
        return err("Invalid job. Valid: seller-payouts, thermostat-ai, device-sync, weekly-digest, vpp-status, all", 400);
    }

    const duration = Date.now() - start;
    logger.info(`[Cron] ${job} completed in ${duration}ms`, result);

    return ok({ job, duration, result });

  } catch (cronErr) {
    const duration = Date.now() - start;
    await alertCritical(`Cron job failed: ${job}`, { error: cronErr.message, duration });
    return err(`Cron job failed: ${cronErr.message}`, 500);
  }
}

// GET /api/cron — list available jobs and last run info
export async function GET(request) {
  if (!verifyCronSecret(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return ok({
    jobs: [
      { id: "seller-payouts",  schedule: "0 9 1,15 * *", description: "Bi-weekly seller ACH payouts" },
      { id: "thermostat-ai",   schedule: "*/30 * * * *", description: "VPP pre-conditioning + AI optimization" },
      { id: "device-sync",     schedule: "*/5 * * * *",  description: "Sync device telemetry from Derapi" },
      { id: "weekly-digest",   schedule: "0 8 * * 1",    description: "Weekly energy summary emails (Mondays)" },
      { id: "vpp-status",      schedule: "* * * * *",    description: "Auto-transition VPP event statuses" },
    ],
  });
}
