import crypto from "node:crypto";
import { z }          from "zod";
import { prisma }     from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole }        from "@/lib/jwt.js";

const createSchema = z.object({
  type:                   z.enum(["INSTALLER","ENTERPRISE","SELLER"]),
  email:                  z.string().email(),
  contactName:            z.string().trim().min(1).optional(),
  companyName:            z.string().trim().min(2),
  phone:                  z.string().trim().optional(),
  website:                z.string().url().optional().or(z.literal("")),
  assignedPlan:           z.string().optional(),
  commissionRate:         z.number().min(0).max(1).optional(),
  successFeeRate:         z.number().min(0).max(1).optional(),
  subscriptionShare:      z.number().min(0).max(1).optional(),
  vppInstallerShare:      z.number().min(0).max(1).optional(),
  marketplaceCategory:    z.string().optional(),
  shippingRequired:       z.boolean().optional(),
  stripeConnectRequired:  z.boolean().optional(),
  taxInfoRequired:        z.boolean().optional(),
  sellerAgreementVersion: z.string().optional(),
  expectedPropertyCount:  z.number().int().min(0).optional(),
  sponsoredHomeowners:    z.boolean().optional(),
  serviceStates:          z.array(z.string()).default([]),
  licenseRequired:        z.boolean().optional(),
  internalNote:           z.string().max(2000).optional(),
  sendImmediately:        z.boolean().default(false),
}).strict();

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const type   = searchParams.get("type");
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const page   = Math.max(1, Number(searchParams.get("page")  || 1));
  const limit  = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 50)));

  const where = {
    ...(type   && { type }),
    ...(status && { status }),
    ...(search && {
      OR: [
        { email:       { contains: search, mode: "insensitive" } },
        { companyName: { contains: search, mode: "insensitive" } },
        { contactName: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [invitations, total] = await Promise.all([
    prisma.partnerInvitation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * limit,
      take:    limit,
      select: {
        id: true, type: true, status: true, email: true,
        contactName: true, companyName: true,
        assignedPlan: true, sentAt: true, openedAt: true,
        acceptedAt: true, approvedAt: true, resendCount: true,
        expiresAt: true, createdAt: true, internalNote: true,
        lastSendError: true,
        // token intentionally omitted from list responses
      },
    }),
    prisma.partnerInvitation.count({ where }),
  ]);

  return ok({ invitations, total, page, pages: Math.ceil(total / limit) });
}

export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  // Block duplicate active invitations for the same email + type
  const existing = await prisma.partnerInvitation.findFirst({
    where: {
      email:  data.email.toLowerCase(),
      type:   data.type,
      status: { in: ["DRAFT","SENT","OPENED","ACCEPTED"] },
    },
  });
  if (existing) return err("An active invitation already exists for this email and partner type", 409);

  const { sendImmediately, ...inviteData } = data;

  const invitation = await prisma.partnerInvitation.create({
    data: {
      ...inviteData,
      email:          data.email.toLowerCase(),
      token:          crypto.randomBytes(32).toString("hex"),
      expiresAt:      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      invitedByUserId: auth.user.id,
      status:         "DRAFT",
    },
  });

  await prisma.platformAuditLog.create({
    data: {
      actorUserId: auth.user.id,
      actorRole:   "ADMIN",
      action:      "PARTNER_INVITATION_CREATED",
      targetType:  "PartnerInvitation",
      targetId:    invitation.id,
      category:    "TEAM",
      metadata:    { type: invitation.type, email: invitation.email, companyName: invitation.companyName },
    },
  }).catch(() => {}); // audit failure must never block invite creation

  // Enqueue for immediate delivery if requested
  if (sendImmediately) {
    await prisma.invitationDeliveryJob.create({
      data: {
        invitationType: "PARTNER_INVITATION",
        invitationId:   invitation.id,
        campaignId:     null,
        recipientEmail: invitation.email,
        status:         "PENDING",
        availableAt:    new Date(),
      },
    }).catch(() => {}); // delivery failure does not abort invite creation
  }

  return ok({ invitation }, 201);
}
