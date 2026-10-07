/**
 * GET /api/admin/community-impact/export — CSV export of all donations,
 * for offline transparency reporting.
 */
import { prisma } from "@/lib/db.js";
import { err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

function csvEscape(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const donations = await prisma.gridFundDonation.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true, email: true } } },
  });

  const header = ["Date", "Donor Name", "Donor Email", "Amount", "Credit Bonus Awarded"];
  const rows = donations.map((d) => [
    new Date(d.createdAt).toISOString(),
    d.user?.name || "",
    d.user?.email || "",
    d.amount.toFixed(2),
    d.creditBonusAwarded,
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="gridguide-donations-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
