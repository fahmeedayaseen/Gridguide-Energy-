/**
 * GET /api/admin/audit-log — unified audit trail, filterable by orgId,
 * actorUserId, action, category, date range.
 *
 * Two ways in, now that Phase 5 exists:
 *   - Platform admin (UserRole ADMIN): full access, any org, any category.
 *   - Enterprise team member: scoped to their OWN org only, with category
 *     restricted by role per the approved matrix:
 *       Owner/Admin -> all categories
 *       Manager     -> ASSIGNMENT + VPP only
 *       Viewer      -> no audit log access at all
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { resolveEnterpriseAccess } from "@/lib/enterprise-permissions.js";

const MANAGER_ALLOWED_CATEGORIES = ["ASSIGNMENT", "VPP"];

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  let orgId = searchParams.get("orgId");
  const actorUserId = searchParams.get("actorUserId");
  const action = searchParams.get("action");
  let category = searchParams.get("category");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "50"));

  const isPlatformAdmin = auth.user.role === "ADMIN";

  if (!isPlatformAdmin) {
    const access = await resolveEnterpriseAccess(auth.user.id);
    if (!access) return err("Enterprise organization not found", 404);
    if (access.role === "Viewer") return err("Viewers do not have audit log access.", 403);

    // Enterprise users are always scoped to their own org, regardless of
    // any orgId they might pass - never lets one org read another's log.
    orgId = access.org.id;

    if (access.role === "Manager") {
      if (category && !MANAGER_ALLOWED_CATEGORIES.includes(category)) {
        return err("Managers can only view Assignment and VPP audit logs.", 403);
      }
      // No category requested - Manager still only sees their allowed set,
      // not silently everything.
      if (!category) {
        const where = { orgId, category: { in: MANAGER_ALLOWED_CATEGORIES }, ...(actorUserId && { actorUserId }), ...(action && { action }), ...((from || to) && { createdAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } }) };
        const [logs, total] = await Promise.all([
          prisma.platformAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
          prisma.platformAuditLog.count({ where }),
        ]);
        return ok({ logs, total, page, limit, yourRole: access.role });
      }
    }
  }

  const where = {
    ...(orgId && { orgId }),
    ...(actorUserId && { actorUserId }),
    ...(action && { action }),
    ...(category && { category }),
    ...((from || to) && { createdAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } }),
  };

  const [logs, total] = await Promise.all([
    prisma.platformAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.platformAuditLog.count({ where }),
  ]);

  return ok({ logs, total, page, limit });
}
