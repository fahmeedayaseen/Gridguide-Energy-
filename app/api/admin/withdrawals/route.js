/**
 * GET /api/admin/withdrawals?status=PENDING_REVIEW|PROCESSING|COMPLETED|FAILED|CANCELLED
 * Admin queue of cash wallet withdrawals. Never returns encrypted bank details —
 * use POST /api/admin/withdrawals/:id { action: "reveal" } for that (audit-logged).
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { WITHDRAWAL_PUBLIC_SELECT } from "@/lib/withdrawals.js";

const STATUSES = ["PENDING_REVIEW", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"];

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const status = new URL(request.url).searchParams.get("status");
  if (status && !STATUSES.includes(status)) return err(`status must be one of ${STATUSES.join(", ")}`, 400);

  const [withdrawals, counts] = await Promise.all([
    prisma.withdrawal.findMany({
      where:   status ? { status } : {},
      orderBy: { createdAt: status === "PENDING_REVIEW" || status === "PROCESSING" ? "asc" : "desc" },
      take:    200,
      select:  {
        ...WITHDRAWAL_PUBLIC_SELECT,
        userId: true,
        reviewedById: true,
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.withdrawal.groupBy({ by: ["status"], _count: { _all: true }, _sum: { grossAmount: true } }),
  ]);

  return ok({
    withdrawals,
    summary: Object.fromEntries(counts.map((c) => [c.status, { count: c._count._all, total: c._sum.grossAmount || 0 }])),
  });
}
