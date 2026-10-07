/**
 * GET    /api/installers/referrals        — list installer's referred homeowners
 * POST   /api/installers/referrals        — add referral (bulk import or single)
 * DELETE /api/installers/referrals?id=    — remove a referral
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";
import { nanoid } from "nanoid";

const addSchema = z.object({
  userId:     z.string().optional(),  // if user already exists
  email:      z.string().email().optional(), // or invite by email
  sourceType: z.enum(["signup","import","qr_code","link"]).default("link"),
});

const bulkSchema = z.object({
  emails: z.array(z.string().email()).max(500),
  sourceType: z.enum(["signup","import","qr_code","link"]).default("import"),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer account not found.", 404);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "";
  const page   = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit  = Math.min(100, parseInt(searchParams.get("limit") || "50"));

  const [referrals, total, stats] = await Promise.all([
    prisma.installerReferral.findMany({
      where: {
        installerId: installer.id,
        ...(status && { conversionStatus: status }),
      },
      orderBy: { referredAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { name: true, email: true, plan: true, lastActiveAt: true, homeAddress: true,
                          vppEnrollment: { select: { active: true } },
                          _count: { select: { devices: true } } } },
      },
    }),
    prisma.installerReferral.count({ where: { installerId: installer.id } }),
    prisma.installerReferral.groupBy({
      by: ["conversionStatus"],
      where: { installerId: installer.id },
      _count: { id: true },
      _sum: { monthlyRevenue: true, lifetimeValue: true },
    }),
  ]);

  const summary = {
    total,
    byStatus: Object.fromEntries(stats.map(s => [s.conversionStatus, {
      count: s._count.id,
      monthlyRevenue: s._sum.monthlyRevenue || 0,
      lifetimeValue:  s._sum.lifetimeValue  || 0,
    }])),
    totalMonthlyRevenue: stats.reduce((acc, s) => acc + (s._sum.monthlyRevenue || 0), 0),
    totalLifetimeValue:  stats.reduce((acc, s) => acc + (s._sum.lifetimeValue  || 0), 0),
  };

  return ok({ referrals, total, page, pages: Math.ceil(total / limit), summary });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer account not found.", 404);

  // Ensure installer has a referral code
  if (!installer.referralCode) {
    installer.referralCode = `GG-${installer.id.slice(-6).toUpperCase()}`;
    await prisma.installer.update({
      where: { id: installer.id },
      data: { referralCode: installer.referralCode },
    });
  }

  const body = await request.json().catch(() => ({}));

  // Bulk import
  if (body.emails) {
    const { data, error } = bulkSchema.safeParse(body);
    if (error) return err("Validation failed.", 400, error);

    let created = 0;
    for (const email of data.emails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) continue;
      const existing = await prisma.installerReferral.findUnique({
        where: { installerId_userId: { installerId: installer.id, userId: user.id } },
      });
      if (existing) continue;
      // Self-reported (installer's own claim, no proof) - starts unverified.
      // Never sets conversionStatus based on the homeowner's CURRENT plan;
      // that was the real gap - an installer bulk-importing a list that
      // happened to include an existing paying customer would have
      // instantly earned commission on them, with zero relationship ever
      // established. Real conversion status still only comes from this
      // homeowner's own subscription events once this referral is verified.
      await prisma.installerReferral.create({
        data: {
          installerId: installer.id,
          userId: user.id,
          referralCode: installer.referralCode || "",
          sourceType: data.sourceType,
          userPlan: user.plan,
          conversionStatus: "referred",
          verified: false,
        },
      });
      await prisma.notification.create({
        data: {
          userId: user.id, type: "INSTALLER_REFERRAL_CLAIMED",
          title: "An installer added you as their referral",
          message: `${installer.companyName} says you're one of their customers. Confirm this in your account if that's correct.`,
          data: { installerId: installer.id, installerName: installer.companyName },
        },
      }).catch(() => {});
      created++;
    }

    await prisma.installer.update({
      where: { id: installer.id },
      data: { totalReferredUsers: { increment: created } },
    });

    return ok({ created, message: `${created} homeowners added to your portfolio, pending their confirmation.` }, 201);
  }

  // Single referral
  const { data, error } = addSchema.safeParse(body);
  if (error) return err("Validation failed.", 400, error);

  if (!data.userId) return err("userId required for single referral.", 400);

  const user = await prisma.user.findUnique({ where: { id: data.userId } });
  if (!user) return err("User not found.", 404);

  const referral = await prisma.installerReferral.create({
    data: {
      installerId: installer.id,
      userId: data.userId,
      referralCode: installer.referralCode || "",
      sourceType: data.sourceType,
      userPlan: user.plan,
      conversionStatus: "referred",
      verified: false, // self-reported claim, no proof yet - see homeowner confirm/admin approve flows
    },
    include: { user: { select: { name: true, email: true, plan: true } } },
  });

  await prisma.installer.update({
    where: { id: installer.id },
    data: { totalReferredUsers: { increment: 1 } },
  });

  await prisma.notification.create({
    data: {
      userId: data.userId, type: "INSTALLER_REFERRAL_CLAIMED",
      title: "An installer added you as their referral",
      message: `${installer.companyName} says you're one of their customers. Confirm this in your account if that's correct.`,
      data: { installerId: installer.id, installerName: installer.companyName },
    },
  }).catch(() => {});

  return ok({ referral, message: "Homeowner added to your portfolio, pending their confirmation." }, 201);
}
