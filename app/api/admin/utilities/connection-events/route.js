/**
 * GET /api/admin/utilities/connection-events
 *
 * Phase 3: "Monitor connection success and errors." Cross-utility view of
 * every attempted homeowner utility connection (see POST /api/utility/accounts,
 * which writes one UtilityConnectionEvent per attempt regardless of outcome).
 *
 * ?utilityId=   filter to one utility
 * ?method=      filter to one connection method (GREEN_BUTTON, ARCADIA, etc.)
 * ?success=true|false
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const utilityId = searchParams.get("utilityId") || undefined;
  const method    = searchParams.get("method") || undefined;
  const successParam = searchParams.get("success");
  const success   = successParam === "true" ? true : successParam === "false" ? false : undefined;
  const page  = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(200, parseInt(searchParams.get("limit") || "50"));
  const skip  = (page - 1) * limit;

  const where = {
    ...(utilityId && { utilityId }),
    ...(method && { method }),
    ...(success !== undefined && { success }),
  };

  const [events, total, byMethod, overallSuccessRate] = await Promise.all([
    prisma.utilityConnectionEvent.findMany({
      where, skip, take: limit,
      orderBy: { createdAt: "desc" },
      include: { utility: { select: { name: true, shortName: true, state: true } } },
    }),
    prisma.utilityConnectionEvent.count({ where }),
    prisma.utilityConnectionEvent.groupBy({
      by: ["method", "success"],
      _count: { id: true },
    }),
    (async () => {
      const [all, ok_] = await Promise.all([
        prisma.utilityConnectionEvent.count(),
        prisma.utilityConnectionEvent.count({ where: { success: true } }),
      ]);
      return all ? Math.round((ok_ / all) * 100) : null;
    })(),
  ]);

  // Reshape groupBy into { method: { success, failed } } for an easy admin-portal bar chart
  const methodBreakdown = {};
  for (const row of byMethod) {
    methodBreakdown[row.method] = methodBreakdown[row.method] || { success: 0, failed: 0 };
    methodBreakdown[row.method][row.success ? "success" : "failed"] = row._count.id;
  }

  return ok({
    events, total, page, limit, pages: Math.ceil(total / limit),
    stats: { overallSuccessRate, byMethod: methodBreakdown },
  });
}
