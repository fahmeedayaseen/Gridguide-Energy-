/**
 * GET   /api/admin/installers           — list all installers with revenue partner metrics
 * PATCH /api/admin/installers?id=       — update installer plan, status, approval
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";
import { getInstallerSuccessFeeRates, getInstallerSuccessFeeRate } from "@/lib/platform-config.js";

const PLAN_SHARE  = { FREE: 0.15, PRO: 0.25, ENTERPRISE: 0.30 };
const PLAN_FEE    = { FREE: 0,    PRO: 99,    ENTERPRISE: 499  };

const updateSchema = z.object({
  verificationStatus: z.enum(["PENDING","VERIFIED","REJECTED","SUSPENDED"]).optional(),
  insuranceVerified:  z.boolean().optional(),
  backgroundChecked:  z.boolean().optional(),
  plan:               z.enum(["FREE","PRO","ENTERPRISE"]).optional(),
  note:               z.string().optional(),
}).strict();

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "";
  const plan   = searchParams.get("plan")   || "";
  const page   = Math.max(1, parseInt(searchParams.get("page")  || "1"));
  const limit  = Math.min(100, parseInt(searchParams.get("limit") || "50"));
  const skip   = (page - 1) * limit;

  const where = {
    ...(status && { verificationStatus: status }),
    ...(plan   && { plan }),
  };

  const [installers, total, planBreakdown, revenueStats] = await Promise.all([
    prisma.installer.findMany({
      where, skip, take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        user:          { select: { name: true, email: true, phone: true, createdAt: true } },
        reviews:       { select: { rating: true }, take: 5 },
        referrals:     { select: { conversionStatus: true, monthlyRevenue: true, installerShare: true } },
        revenueShares: { orderBy: { periodStart: "desc" }, take: 3,
                         select: { netPayout: true, activeHomeowners: true, periodStart: true, status: true } },
        vppEarnings:   { select: { installerShare: true } },
        certifications:{ select: { name: true, status: true } },
        serviceZones:  { select: { city: true, state: true, radiusMiles: true } },
        _count:        { select: { leads: true, jobs: true, referrals: true } },
      },
    }),
    prisma.installer.count({ where }),
    prisma.installer.groupBy({
      by: ["plan"],
      _count: { id: true },
      _sum: { monthlyReferralEarnings: true },
    }),
    prisma.installerReferral.aggregate({
      _count: { id: true },
      _sum: { monthlyRevenue: true, installerShare: true, lifetimeValue: true },
    }),
  ]);

  const feeRates = await getInstallerSuccessFeeRates();
  const enriched = installers.map(inst => {
    const subscribed   = inst.referrals.filter(r => r.conversionStatus === "subscribed" && r.verified);
    const monthlyGross = subscribed.reduce((a, r) => a + r.monthlyRevenue, 0);
    const monthlyShare = subscribed.reduce((a, r) => a + r.installerShare, 0);
    const vppTotal     = inst.vppEarnings.reduce((a, e) => a + e.installerShare, 0);
    const avgRating    = inst.reviews.length > 0
      ? (inst.reviews.reduce((a, r) => a + r.rating, 0) / inst.reviews.length).toFixed(1)
      : null;
    return {
      ...inst,
      metrics: {
        totalReferrals:  inst._count.referrals,
        subscribedHomes: subscribed.length,
        monthlyGross,
        monthlyShare:    parseFloat(monthlyShare.toFixed(2)),
        vppTotalEarned:  parseFloat(vppTotal.toFixed(2)),
        netMonthly:      parseFloat((monthlyShare - (PLAN_FEE[inst.plan] || 0)).toFixed(2)),
        shareRate:       PLAN_SHARE[inst.plan] || 0.15,
        successFeeRate:  feeRates[inst.plan] ?? feeRates.FREE,
        avgRating,
      },
    };
  });

  return ok({
    installers: enriched,
    total,
    page,
    pages: Math.ceil(total / limit),
    summary: {
      byPlan: Object.fromEntries(planBreakdown.map(p => [p.plan, {
        count: p._count.id,
        totalMonthlyEarnings: p._sum.monthlyReferralEarnings || 0,
      }])),
      network: {
        totalReferrals:      revenueStats._count.id,
        totalMonthlyGross:   parseFloat((revenueStats._sum.monthlyRevenue  || 0).toFixed(2)),
        totalMonthlyPayouts: parseFloat((revenueStats._sum.installerShare  || 0).toFixed(2)),
        totalLifetimeValue:  parseFloat((revenueStats._sum.lifetimeValue   || 0).toFixed(2)),
      },
    },
  });
}

export async function PATCH(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const installerId = searchParams.get("id");
  if (!installerId) return err("Installer ID required", 400);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const updateData = {
    ...(data.verificationStatus && { verificationStatus: data.verificationStatus }),
    ...(data.insuranceVerified  !== undefined && { insuranceVerified: data.insuranceVerified }),
    ...(data.backgroundChecked  !== undefined && { backgroundChecked: data.backgroundChecked }),
    ...(data.plan && {
      plan:                 data.plan,
      revenueSharePct:      PLAN_SHARE[data.plan],
      membershipMonthlyFee: PLAN_FEE[data.plan],
      successFeeRate:       await getInstallerSuccessFeeRate(data.plan),
    }),
  };

  const installer = await prisma.installer.update({
    where: { id: installerId },
    data:  updateData,
    include: { user: { select: { name: true, email: true } } },
  });

  // Notify installer on approval
  if (data.verificationStatus === "VERIFIED") {
    await prisma.notification.create({
      data: {
        userId:  installer.userId,
        type:    "INSTALLER_APPROVED",
        title:   "Welcome to the GridGuide Partner Network!",
        message: `Your account is verified. You're on the ${installer.plan} plan with ${Math.round((PLAN_SHARE[installer.plan]||0.15)*100)}% revenue share.`,
      },
    }).catch(() => {});
  } else if (data.verificationStatus === "REJECTED") {
    await prisma.notification.create({
      data: {
        userId:  installer.userId,
        type:    "INSTALLER_REJECTED",
        title:   "Installer Application — Action Required",
        message: data.note || "Your application requires additional documentation. Contact support@gridguide.ai.",
      },
    }).catch(() => {});
  }

  // Propagate plan change to existing referrals
  if (data.plan) {
    const oldPlan = await prisma.installer.findUnique({ where: { id: installerId }, select: { plan: true } });
    if (oldPlan && oldPlan.plan !== data.plan) {
      await prisma.installerReferral.updateMany({
        where: { installerId },
        data: { installerShare: { multiply: PLAN_SHARE[data.plan] / (PLAN_SHARE[oldPlan.plan] || 0.15) } },
      }).catch(() => {});
    }
  }

  return ok({
    installer: {
      id: installer.id,
      plan: installer.plan,
      verificationStatus: installer.verificationStatus,
      revenueSharePct: installer.revenueSharePct,
    },
    message: `Installer updated. Plan: ${installer.plan}, Share: ${Math.round((installer.revenueSharePct||0.15)*100)}%.`,
  });
}
