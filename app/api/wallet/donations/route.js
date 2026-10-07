/**
 * GET /api/wallet/donations
 * Returns the logged-in homeowner's GridGuide Community Fund donation
 * history — every donation amount, date, and the credit bonus earned back.
 */
import { prisma }              from "@/lib/db.js";
import { ok, err }             from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "50"));

  const donations = await prisma.gridFundDonation.findMany({
    where:   { userId: auth.user.id },
    orderBy: { createdAt: "desc" },
    take:    limit,
  });

  const totalDonated     = donations.reduce((a, d) => a + d.amount, 0);
  const totalCreditsEarned = donations.reduce((a, d) => a + d.creditBonusAwarded, 0);

  return ok({
    donations: donations.map(d => ({
      id:            d.id,
      amount:        d.amount,
      creditBonus:   d.creditBonusAwarded,
      createdAt:     d.createdAt,
    })),
    summary: {
      totalDonations:       donations.length,
      totalDonated:         Math.round(totalDonated * 100) / 100,
      totalCreditsEarned,
    },
  });
}
