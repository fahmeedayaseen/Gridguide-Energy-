import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  if (auth.user?.role !== "ADMIN") return err("Admin access required", 403);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  const source = searchParams.get("source") || undefined;
  const transactions = await prisma.revenueTransaction.findMany({
    where: { ...(status && { status }), ...(source && { source }) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const totals = transactions.reduce((acc, row) => {
    acc.grossAmount += row.grossAmount;
    acc.gridguideFee += row.gridguideFee;
    acc.netAmount += row.netAmount;
    return acc;
  }, { grossAmount: 0, gridguideFee: 0, netAmount: 0 });
  return ok({ transactions, totals });
}
