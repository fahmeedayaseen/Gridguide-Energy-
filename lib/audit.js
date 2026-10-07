/**
 * Phase 7: single write-through audit log. Call this from any write path
 * touching enterprise, installer, billing, or VPP data - one shared helper
 * so future features have an easy, obvious place to log, rather than each
 * relying on remembering independently.
 *
 * category drives role-scoped read access in GET /api/admin/audit-log:
 *   Owner/Admin -> all categories. Manager -> ASSIGNMENT + VPP only.
 *   Viewer -> no access at all.
 */
import { prisma } from "@/lib/db.js";

export async function logAudit({ actorUserId = null, actorRole = null, action, targetType = null, targetId = null, orgId = null, category, metadata = null }) {
  try {
    await prisma.platformAuditLog.create({
      data: { actorUserId, actorRole, action, targetType, targetId, orgId, category, metadata },
    });
  } catch (e) {
    // Never let audit logging break the actual operation it's describing.
    console.error("[Audit] Failed to write log entry:", action, e.message);
  }
}
