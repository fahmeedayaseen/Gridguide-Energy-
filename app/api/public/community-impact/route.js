/**
 * GET /api/public/community-impact — PUBLIC, unauthenticated. Powers the
 * Community Impact page on the GridGuideEnergy marketing site.
 *
 * Never returns individual donor names/emails or anything else that would
 * identify a specific homeowner - only aggregates. If
 * publicDonationCounterEnabled is off, returns a minimal { enabled: false }
 * response and nothing else, so the page can render a graceful placeholder
 * instead of a broken dashboard.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { getPlatformConfig } from "@/lib/platform-config.js";

// This endpoint is database-backed and must execute at request time. Without
// this declaration Next.js attempts to query production data during builds.
export const dynamic = "force-dynamic";

// Same EPA average grid emissions factor used in the Enterprise carbon
// estimate, for consistency across the platform. This is real dispatched
// VPP energy, not estimated installed capacity, so it's a more direct
// figure than the Enterprise-side estimate - but still an estimate of
// CO2 impact, not a measured one, since no direct emissions monitoring
// exists in this schema.
const GRID_EMISSIONS_KG_PER_KWH = 0.386;

export async function GET() {
  const cfg = await getPlatformConfig();

  if (!cfg.publicDonationCounterEnabled) {
    return ok({ enabled: false });
  }

  const allDonations = await prisma.gridFundDonation.findMany({
    select: { userId: true, amount: true, createdAt: true },
  });

  const totalDonatedLifetime = allDonations.reduce((a, d) => a + d.amount, 0);
  const campaignDonations = allDonations.filter((d) => d.createdAt >= cfg.communityGoalStartDate);
  const totalDonatedCampaign = campaignDonations.reduce((a, d) => a + d.amount, 0);
  const totalDonors = new Set(allDonations.map((d) => d.userId)).size;

  const goalCurrentAmount = cfg.donationDisplayMode === "lifetime" ? totalDonatedLifetime : totalDonatedCampaign;
  const percentComplete = cfg.communityGoalTargetAmount > 0
    ? Math.min(100, Math.round((goalCurrentAmount / cfg.communityGoalTargetAmount) * 1000) / 10)
    : 0;

  // Monthly trend, last 12 months, lifetime data (the trend chart shows the
  // full history regardless of display mode - only the goal progress bar
  // itself respects lifetime vs campaign).
  const byMonth = {};
  for (const d of allDonations) {
    const date = new Date(d.createdAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = { period: key, totalDonated: 0, donationCount: 0 };
    byMonth[key].totalDonated += d.amount;
    byMonth[key].donationCount += 1;
  }
  const monthlyTrend = Object.values(byMonth).sort((a, b) => a.period.localeCompare(b.period)).slice(-12);

  const byYear = {};
  for (const d of allDonations) {
    const year = new Date(d.createdAt).getFullYear();
    if (!byYear[year]) byYear[year] = { year, totalDonated: 0, donationCount: 0 };
    byYear[year].totalDonated += d.amount;
    byYear[year].donationCount += 1;
  }
  const yearlyTrend = Object.values(byYear).sort((a, b) => a.year - b.year);

  const projects = await prisma.communityFundProject.findMany({
    where: { isPublished: true },
    orderBy: { fundedAt: "desc" },
    select: { id: true, title: true, description: true, amountFunded: true, recipientName: true, receiptUrl: true, fundedAt: true },
  });

  // VPP comparison - total payouts actually made to homeowners platform-wide,
  // for the "donations vs. VPP earnings" comparison the review requested.
  const vppPayouts = await prisma.vppPayout.findMany({
    where: { status: "PAID" },
    select: { netAmount: true, kwhDispatched: true, userId: true },
  });
  const totalVppPayouts = vppPayouts.reduce((a, p) => a + p.netAmount, 0);
  const totalKwhDispatched = vppPayouts.reduce((a, p) => a + p.kwhDispatched, 0);
  const participatingHomeowners = new Set(vppPayouts.map((p) => p.userId)).size;
  const estimatedCo2AvoidedKg = totalKwhDispatched * GRID_EMISSIONS_KG_PER_KWH;

  return ok({
    enabled: true,
    goal: {
      label: cfg.communityGoalLabel,
      targetAmount: cfg.communityGoalTargetAmount,
      currentAmount: Math.round(goalCurrentAmount * 100) / 100,
      percentComplete,
      displayMode: cfg.donationDisplayMode,
      periodStart: cfg.donationDisplayMode === "campaign" ? cfg.communityGoalStartDate : null,
    },
    summary: {
      totalDonatedLifetime: Math.round(totalDonatedLifetime * 100) / 100,
      totalDonatedCampaign: Math.round(totalDonatedCampaign * 100) / 100,
      totalDonors,
      totalDonations: allDonations.length,
    },
    monthlyTrend,
    yearlyTrend,
    projects,
    vppComparison: {
      totalVppPayouts: Math.round(totalVppPayouts * 100) / 100,
      totalDonated: Math.round(totalDonatedLifetime * 100) / 100,
      donationPctOfVpp: totalVppPayouts > 0 ? Math.round((totalDonatedLifetime / totalVppPayouts) * 1000) / 10 : 0,
    },
    environmentalImpact: {
      totalKwhDispatched: Math.round(totalKwhDispatched),
      estimatedCo2AvoidedTons: Math.round((estimatedCo2AvoidedKg / 1000) * 10) / 10,
      participatingHomeowners,
    },
    methodology: "Environmental impact is estimated from real dispatched VPP energy using the EPA's average US grid emissions factor (0.386 kg CO2/kWh) - this schema does not have direct emissions monitoring, so treat this as a standard industry estimate, not a measured figure.",
  });
}
