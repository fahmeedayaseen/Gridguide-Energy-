/**
 * GET  /api/enterprise/campaigns — list org campaigns
 * POST /api/enterprise/campaigns — create campaign WITH recipients (required)
 *
 * P0 fix: inviteIds is required and validated against org ownership.
 * Rejects campaign creation with zero recipients.
 */
import { prisma }              from "@/lib/db.js";
import { ok, err, parseBody }  from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";
import { z }                   from "zod";

const campaignSchema = z.object({
  name:       z.string().min(1).max(100),
  subject:    z.string().min(1).max(200),
  body:       z.string().optional(),
  inviteIds:  z.array(z.string().min(1)).min(1, "At least one recipient is required."),
  scheduledAt:z.string().datetime().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);

  const campaigns = await prisma.enterpriseCampaign.findMany({
    where:   { orgId: access.org.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { invites: true } } },
  });
  return ok({ campaigns });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);

  const { data, error } = await parseBody(request, campaignSchema);
  if (error) return err(error.issues?.[0]?.message || "Validation failed", 400, error);

  // P0: Validate every inviteId belongs to this org — cross-org attach rejected
  const ownedInvites = await prisma.enterpriseHomeownerInvite.findMany({
    where: { id: { in: data.inviteIds }, orgId: access.org.id },
    select: { id: true },
  });
  if (ownedInvites.length !== data.inviteIds.length) {
    return err("One or more recipients do not belong to this organization.", 403);
  }

  const campaign = await prisma.enterpriseCampaign.create({
    data: {
      orgId:       access.org.id,
      name:        data.name,
      subject:     data.subject,
      body:        data.body,
      status:      data.scheduledAt ? "SCHEDULED" : "DRAFT",
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
    },
  });

  // Attach recipients to campaign
  await prisma.enterpriseHomeownerInvite.updateMany({
    where: { id: { in: data.inviteIds }, orgId: access.org.id },
    data:  { campaignId: campaign.id },
  });

  return ok({ campaign, recipientCount: ownedInvites.length }, 201);
}
