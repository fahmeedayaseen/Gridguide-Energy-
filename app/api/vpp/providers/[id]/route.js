/**
 * PATCH /api/vpp/providers/[id] — admin controls for one provider:
 * status, publicVisible, enrollmentOpen. Audit-logged.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";
import { isProviderPubliclyVisible, canProviderAcceptEnrollment, isEnergyHubEnabled } from "@/lib/vpp/provider-controls.js";

const patchSchema = z.object({
  status:         z.enum(["ACTIVE", "SANDBOX", "PENDING_CREDENTIALS", "PAUSED", "ERROR"]).optional(),
  publicVisible:  z.boolean().optional(),
  enrollmentOpen: z.boolean().optional(),
  notes:          z.string().max(2000).optional(),
}).strict();

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, patchSchema);
  if (error) return err("Validation failed", 400, error);

  const before = await prisma.vppProvider.findUnique({ where: { id: params.id } });
  if (!before) return err("VPP provider not found", 404);

  // Opening enrollment implies the provider must also be visible.
  const next = { ...data };
  if (next.enrollmentOpen === true && next.publicVisible === undefined && !before.publicVisible) next.publicVisible = true;
  if (next.publicVisible === false) next.enrollmentOpen = false;

  const provider = await prisma.vppProvider.update({ where: { id: params.id }, data: next });

  await prisma.platformAuditLog.create({
    data: {
      actorUserId: auth.user.id, actorRole: "ADMIN", action: "VPP_PROVIDER_UPDATED",
      targetType: "VppProvider", targetId: provider.id, category: "VPP",
      metadata: { before: { status: before.status, publicVisible: before.publicVisible, enrollmentOpen: before.enrollmentOpen }, after: next },
    },
  }).catch((e) => console.error("[vpp/providers] audit log failed:", e.message));

  const warning = provider.key === "energyhub" && !isEnergyHubEnabled()
    ? "EnergyHub stays hidden until ENERGYHUB_ENABLED=true is set in the environment."
    : null;

  return ok({
    provider: { ...provider, publiclyVisible: isProviderPubliclyVisible(provider), acceptingEnrollment: canProviderAcceptEnrollment(provider) },
    ...(warning && { warning }),
  });
}
