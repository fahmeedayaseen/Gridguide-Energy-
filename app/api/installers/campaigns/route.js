/**
 * GET  /api/installers/campaigns     — list campaigns
 * POST /api/installers/campaigns     — create campaign
 */
import { prisma }              from "@/lib/db.js";
import { ok, err, parseBody }  from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z }                   from "zod";

const campaignSchema = z.object({
  name:        z.string().min(1).max(100),
  subject:     z.string().min(1).max(200),
  body:        z.string().optional(),
  inviteIds:   z.array(z.string()).optional(),
  scheduledAt: z.string().datetime().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);

  const campaigns = await prisma.installerCampaign.findMany({
    where: { installerId: installer.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { invites: true } } },
  });

  return ok({ campaigns });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);

  const { data, error } = await parseBody(request, campaignSchema);
  if (error) return err("Validation failed", 400, error);

  const campaign = await prisma.installerCampaign.create({
    data: {
      installerId: installer.id,
      name:        data.name,
      subject:     data.subject,
      body:        data.body,
      status:      data.scheduledAt ? "SCHEDULED" : "DRAFT",
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
    },
  });

  // Attach invites to campaign
  if (data.inviteIds?.length) {
    await prisma.installerCustomerInvite.updateMany({
      where: { id: { in: data.inviteIds }, installerId: installer.id },
      data: { campaignId: campaign.id },
    });
  }

  return ok({ campaign }, 201);
}
