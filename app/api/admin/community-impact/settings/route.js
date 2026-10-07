/**
 * GET   /api/admin/community-impact/settings — current goal/display config
 * PATCH /api/admin/community-impact/settings — update it
 *
 * "Reset the goal" is done by setting a new communityGoalStartDate (and
 * optionally a new targetAmount) - campaign-mode totals only count
 * donations from that date forward, so this is a real reset without
 * needing to touch any donation records.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { getPlatformConfig, invalidatePlatformConfigCache } from "@/lib/platform-config.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const updateSchema = z.object({
  publicDonationCounterEnabled: z.boolean().optional(),
  donationDisplayMode: z.enum(["lifetime", "campaign"]).optional(),
  communityGoalLabel: z.string().min(1).max(150).optional(),
  communityGoalTargetAmount: z.number().positive().optional(),
  resetGoal: z.boolean().optional(), // if true, sets communityGoalStartDate to now
}).strict();

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const cfg = await getPlatformConfig();
  return ok({
    settings: {
      publicDonationCounterEnabled: cfg.publicDonationCounterEnabled,
      donationDisplayMode: cfg.donationDisplayMode,
      communityGoalLabel: cfg.communityGoalLabel,
      communityGoalTargetAmount: cfg.communityGoalTargetAmount,
      communityGoalStartDate: cfg.communityGoalStartDate,
    },
  });
}

export async function PATCH(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const { resetGoal, ...rest } = data;
  const updateData = { ...rest };
  if (resetGoal) updateData.communityGoalStartDate = new Date();

  const updated = await prisma.platformConfig.upsert({
    where:  { id: "singleton" },
    update: updateData,
    create: { id: "singleton", ...updateData },
  });
  invalidatePlatformConfigCache();

  await logAudit({
    actorUserId: auth.user.id, actorRole: "ADMIN", action: "COMMUNITY_IMPACT_SETTINGS_UPDATED",
    category: "OTHER", metadata: { ...rest, resetGoal: !!resetGoal },
  });

  return ok({ settings: updated, message: resetGoal ? "Goal reset — tracking restarts from today." : "Settings saved." });
}
