import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest, requireRole } from "@/lib/jwt.js";
import { z } from "zod";
import { getLeadSuccessFeeRate } from "@/lib/installer-plans.js";

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

  // Free installers see the lead but not the homeowner's contact details or
  // notes (a Pro feature). Redact here so the data never reaches the browser.
  const redact = !isAdmin && installer?.plan === "FREE";
  const out = redact
    ? leads.map((l) => ({ ...l, customerEmail: null, customerPhone: null, notes: null,
        customerName: (l.customerName || "").split(" ").map((w, i) => (i === 0 ? w : `${w[0] || ""}.`)).join(" "),
        contactRedacted: true }))
    : leads;

  return ok({ leads: out });
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

  // Success fee from the installer's plan (admin-configurable; 10% / 7% / 5%).
  // Previously used a nonexistent BASIC plan key and 9/6/5% rates, so every
  // Free installer was billed 9% instead of 10%.
  const rate = await getLeadSuccessFeeRate(installer.plan);
  const successFee = data.estimatedValue ? data.estimatedValue * rate : null;

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

  // If converted, create the job once. Job.leadId is unique, so converting a
  // lead that already has a job (e.g. from an accepted proposal, or a second
  // CONVERTED update) used to throw and return a 500.
  if (data.status === "CONVERTED") {
    const existingJob = await prisma.job.findUnique({ where: { leadId: lead.id } });
    if (!existingJob) {
      const projectValue   = updated.estimatedValue || 0;
      const successFeeRate = await getLeadSuccessFeeRate(lead.installer.plan);
      await prisma.job.create({
        data: {
          installerId:  lead.installerId,
          leadId:       lead.id,
          title:        `${lead.projectType} — ${lead.customerName}`,
          address:      lead.address,
          projectValue,
          successFee:   projectValue * successFeeRate,
          successFeeRate,
          status:       "SCHEDULED",
        },
      });
    }
  }

  return ok({ lead: updated });
}
