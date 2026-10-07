import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { sendEmail } from "@/lib/email.js";
import { z } from "zod";
const inviteSchema = z.object({ email: z.string().email(), role: z.enum(["MANAGER","SUPPORT","VIEWER"]) });
export async function POST(request) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller not found", 404);
  const { data, error } = await parseBody(request, inviteSchema);
  if (error) return err("Validation failed", 400, error);
  const expiresAt = new Date(Date.now() + 7*24*60*60*1000);
  const baseUrl   = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";

  // P0-3: create invite AND delivery job in one transaction — no orphaned invites
  const invite = await prisma.$transaction(async tx => {
    const created = await tx.sellerTeamInvite.upsert({
      where:  { sellerId_email: { sellerId: seller.id, email: data.email.toLowerCase() } },
      create: { sellerId: seller.id, email: data.email.toLowerCase(), role: data.role,
                expiresAt, createdById: auth.user.id },
      update: { role: data.role, status: "PENDING", expiresAt },
    });
    // Keep this endpoint idempotent: do not create a second active job for the same invite.
    const existingJob = await tx.invitationDeliveryJob.findFirst({
      where: {
        invitationType: "SELLER_TEAM_INVITE",
        invitationId:   created.id,
        campaignId:     null,
        status:         { in: ["PENDING", "QUEUED", "SENDING"] },
      },
      select: { id: true },
    });

    if (!existingJob) {
      // Job creation failure rolls back the invite — no orphaned invites.
      await tx.invitationDeliveryJob.create({
        data: {
          invitationType: "SELLER_TEAM_INVITE",
          invitationId:   created.id,
          campaignId:     null,
          recipientEmail: created.email,
          status:         "PENDING",
          availableAt:    new Date(),
        },
      });
    }
    return created;
  });

  return ok({
    invite,
    inviteUrl: `${baseUrl}/seller/join/${invite.token}`,
    status: "queued",  // email will be sent by the delivery worker, not inline
  }, 201);
}
