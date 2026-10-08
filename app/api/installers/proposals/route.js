/**
 * GET    /api/installers/proposals         — list proposals for installer
 * POST   /api/installers/proposals         — create proposal
 * PATCH  /api/installers/proposals?id=     — update status / send
 * DELETE /api/installers/proposals?id=     — delete draft
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";
import { getLeadSuccessFeeRate } from "@/lib/installer-plans.js";

const createSchema = z.object({
  leadId:      z.string(),
  title:       z.string().min(1),
  amount:      z.number().positive(),
  notes:       z.string().optional(),
  lineItems:   z.array(z.object({
    description: z.string(),
    qty:         z.number().default(1),
    unitPrice:   z.number(),
  })).optional(),
  validUntil:  z.string().optional(), // ISO date string
});

const updateSchema = z.object({
  status:    z.enum(["DRAFT","SENT","ACCEPTED","DECLINED","EXPIRED"]).optional(),
  notes:     z.string().optional(),
  amount:    z.number().positive().optional(),
  lineItems: z.array(z.any()).optional(),
}).strict();

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({
    where: { userId: auth.user.id },
  });
  if (!installer) return err("Installer not found", 404);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const leadId = searchParams.get("leadId");

  const proposals = await prisma.proposal.findMany({
    where: {
      installerId: installer.id,
      ...(status && { status }),
      ...(leadId && { leadId }),
    },
    include: {
      lead: {
        select: {
          id: true, customerName: true, customerEmail: true,
          projectType: true, address: true, estimatedValue: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Compute summary stats
  const stats = {
    total:         proposals.length,
    drafts:        proposals.filter(p => p.status === "DRAFT").length,
    sent:          proposals.filter(p => p.status === "SENT").length,
    accepted:      proposals.filter(p => p.status === "ACCEPTED").length,
    totalValue:    proposals.reduce((a, p) => a + p.amount, 0),
    acceptedValue: proposals.filter(p => p.status === "ACCEPTED").reduce((a, p) => a + p.amount, 0),
    conversionRate: proposals.filter(p => p.status !== "DRAFT").length > 0
      ? (proposals.filter(p => p.status === "ACCEPTED").length /
         proposals.filter(p => p.status !== "DRAFT").length * 100).toFixed(1)
      : "0",
  };

  return ok({ proposals, stats });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({
    where: { userId: auth.user.id },
  });
  if (!installer) return err("Installer not found", 404);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  // Verify lead belongs to this installer
  const lead = await prisma.installerLead.findFirst({
    where: { id: data.leadId, installerId: installer.id },
  });
  if (!lead) return err("Lead not found or not assigned to you", 404);

  const proposal = await prisma.proposal.create({
    data: {
      installerId: installer.id,
      leadId:      data.leadId,
      title:       data.title,
      amount:      data.amount,
      notes:       data.notes,
      lineItems:   data.lineItems,
      validUntil:  data.validUntil ? new Date(data.validUntil) : null,
      status:      "DRAFT",
    },
    include: { lead: { select: { customerName: true, customerEmail: true } } },
  });

  return ok({ proposal, message: "Proposal created as draft." }, 201);
}

export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const proposalId = searchParams.get("id");
  if (!proposalId) return err("Proposal ID required", 400);

  const installer = await prisma.installer.findUnique({
    where: { userId: auth.user.id },
  });
  if (!installer) return err("Installer not found", 404);

  const proposal = await prisma.proposal.findFirst({
    where: { id: proposalId, installerId: installer.id },
    include: { lead: true },
  });
  if (!proposal) return err("Proposal not found", 404);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const updateData = { ...data };

  // Handle status transitions with timestamps
  if (data.status === "SENT" && proposal.status === "DRAFT") {
    updateData.sentAt = new Date();
    // Notify homeowner (in production, send email)
    await prisma.notification.create({
      data: {
        userId:  proposal.lead.customerEmail ? undefined : installer.userId,
        type:    "PROPOSAL_SENT",
        title:   "Proposal Sent",
        message: `Proposal "${proposal.title}" for $${proposal.amount.toLocaleString()} sent to ${proposal.lead.customerName}.`,
      },
    }).catch(() => {});
  }
  if (data.status === "ACCEPTED") updateData.acceptedAt = new Date();
  if (data.status === "DECLINED") updateData.declinedAt = new Date();

  // If accepted, create/update the job
  if (data.status === "ACCEPTED" && proposal.status !== "ACCEPTED") {
    const existingJob = await prisma.job.findFirst({
      where: { installerId: installer.id, leadId: proposal.leadId },
    });
    if (!existingJob) {
      // Proposals are always for a GridGuide lead, so the plan's lead success fee applies.
      const acceptedFeeRate = await getLeadSuccessFeeRate(installer.plan);
      await prisma.job.create({
        data: {
          installerId:  installer.id,
          leadId:       proposal.leadId,
          title:        proposal.title,
          address:      proposal.lead.address,
          projectValue: proposal.amount,
          successFee:     proposal.amount * acceptedFeeRate,
          successFeeRate: acceptedFeeRate,
          status:         "SCHEDULED",
        },
      });
    }
    // Update lead to CONVERTED
    await prisma.installerLead.update({
      where: { id: proposal.leadId },
      data:  { status: "CONVERTED" },
    }).catch(() => {});
  }

  const updated = await prisma.proposal.update({
    where: { id: proposalId },
    data:  updateData,
    include: { lead: { select: { customerName: true } } },
  });

  return ok({ proposal: updated });
}

export async function DELETE(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const proposalId = searchParams.get("id");
  if (!proposalId) return err("Proposal ID required", 400);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);

  const proposal = await prisma.proposal.findFirst({
    where: { id: proposalId, installerId: installer.id },
  });
  if (!proposal) return err("Proposal not found", 404);
  if (proposal.status !== "DRAFT") return err("Only drafts can be deleted", 409);

  await prisma.proposal.delete({ where: { id: proposalId } });
  return ok({ message: "Proposal deleted." });
}
