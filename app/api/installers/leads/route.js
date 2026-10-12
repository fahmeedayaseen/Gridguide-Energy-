import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest, requireRole } from "@/lib/jwt.js";
import { z } from "zod";
import { getInstallerSuccessFeeRate, computeInstallerSuccessFee } from "@/lib/platform-config.js";

const leadSchema = z.object({
  installerId:   z.string(),
  customerName:  z.string(),
  customerEmail: z.string().email(),
  customerPhone: z.string().optional(),
  address:       z.string(),
  projectType:   z.string(),
  projectSize:   z.number().optional(),
  notes:         z.string().optional(),
  estimatedValue: z.number().optional(),
});

const updateLeadSchema = z.object({
  status:        z.enum(["NEW","CONTACTED","QUOTED","CONVERTED","LOST"]).optional(),
  notes:         z.string().optional(),
  estimatedValue: z.number().optional(),
});

// GET /api/installers/leads — get leads for the authenticated installer
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({
    where: { userId: auth.user.id },
  });

  // Admins can see all leads
  const isAdmin = auth.user.role === "ADMIN";
  if (!installer && !isAdmin) return err("Installer account not found", 404);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const installerId = isAdmin ? searchParams.get("installerId") : installer?.id;

  const leads = await prisma.installerLead.findMany({
    where: {
      ...(installerId && { installerId }),
      ...(status && { status }),
    },
    include: {
      installer: { select: { companyName: true } },
      job: { select: { id: true, status: true, completedAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return ok({ leads });
}

// POST /api/installers/leads — admin or system creates a lead for an installer
export async function POST(request) {
  const auth = await requireRole(request, "ADMIN", "CONSUMER");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, leadSchema);
  if (error) return err("Validation failed", 400, error);

  const installer = await prisma.installer.findUnique({
    where: { id: data.installerId },
  });
  if (!installer) return err("Installer not found", 404);
  if (installer.verificationStatus !== "VERIFIED") {
    return err("Installer is not yet verified", 409);
  }

  // Estimated success fee on this GridGuide-sourced lead, from the single
  // plan-tiered source of truth (Free 10% · Pro 7% · Enterprise 5%). The fee
  // actually charged is computed again when the job is created.
  const rate = await getInstallerSuccessFeeRate(installer.plan);
  const successFee = data.estimatedValue ? computeInstallerSuccessFee(data.estimatedValue, rate) : null;

  const lead = await prisma.installerLead.create({
    data: { ...data, successFee },
  });

  // Notify installer
  await prisma.notification.create({
    data: {
      userId:  installer.userId,
      type:    "NEW_LEAD",
      title:   "New Lead Received",
      message: `New ${data.projectType} project lead in ${data.address}. ${data.estimatedValue ? `Estimated value: $${data.estimatedValue.toLocaleString()}` : ""}`,
      data:    { leadId: lead.id },
    },
  });

  return ok({ lead, message: "Lead assigned to installer." }, 201);
}

// PATCH /api/installers/leads — update lead status
export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const leadId = searchParams.get("id");
  if (!leadId) return err("Lead ID required", 400);

  const { data, error } = await parseBody(request, updateLeadSchema);
  if (error) return err("Validation failed", 400, error);

  // Verify ownership
  const lead = await prisma.installerLead.findUnique({
    where: { id: leadId },
    include: { installer: true },
  });
  if (!lead) return err("Lead not found", 404);
  if (lead.installer.userId !== auth.user.id && auth.user.role !== "ADMIN") {
    return err("Unauthorized", 403);
  }

  const updated = await prisma.installerLead.update({
    where: { id: leadId },
    data,
  });

  // If converted, create a job record
  if (data.status === "CONVERTED") {
    await prisma.job.create({
      data: {
        installerId:  lead.installerId,
        leadId:       lead.id,
        title:        `${lead.projectType} — ${lead.customerName}`,
        address:      lead.address,
        projectValue: lead.estimatedValue || 0,
        successFee:   lead.successFee || 0,
        status:       "SCHEDULED",
      },
    });
  }

  return ok({ lead: updated });
}
