import { parseCustomerCsv, validateCustomerRows } from "@/lib/csv.js";
/**
 * POST /api/enterprise/import — bulk homeowner CSV import for enterprise orgs
 * GET  /api/enterprise/import — list import batches for the org
 *
 * Same logic as /api/installers/import but org-scoped and uses
 * EnterpriseHomeownerInvite instead of InstallerCustomerInvite.
 * Existing GridGuide users get an EnterpriseHomeownerInvite in SIGNED_UP status
 * (they already have an account — skip the invite email, just track the relationship).
 * Non-members get a PENDING invite with a token for the campaign send step.
 */
import { prisma }              from "@/lib/db.js";
import { ok, err, parseBody }  from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";
import { z }                   from "zod";
import { v4 as uuid }          from "uuid";

const rowSchema = z.object({
  email:             z.string().email(),
  first_name:        z.string().optional(),
  last_name:         z.string().optional(),
  phone:             z.string().optional(),
  address:           z.string().optional(),
  city:              z.string().optional(),
  state:             z.string().optional(),
  zip:               z.string().optional(),
  system_type:       z.string().optional(),
  battery:           z.string().optional(),
  utility:           z.string().optional(),
  installer_id:      z.string().optional(), // attribute to a network installer
});

const importSchema = z.object({
  rows:       z.array(z.record(z.string())).max(5000),
  campaignId: z.string().optional(),
  preview:    z.boolean().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);

  const batches = await prisma.enterpriseImportBatch.findMany({
    where: { orgId: access.org.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { _count: { select: { invites: true } } },
  });

  return ok({ batches });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  const body = await request.json().catch(() => null);
  if (!body) return err("Invalid JSON body", 400);

  // Preview mode — validate rows without writing
  if (body.preview === true) {
    const rows = body.rows ?? [];
    const results = rows.slice(0, 5000).map((row, i) => {
      const parsed = rowSchema.safeParse(row);
      if (!parsed.success) return { row: i+1, email: row.email||"", valid: false, error: parsed.error.issues[0]?.message };
      return { row: i+1, email: parsed.data.email, valid: true };
    });
    const valid   = results.filter(r => r.valid).length;
    const invalid = results.filter(r => !r.valid);
    return ok({ preview: true, total: rows.length, valid, invalid, sample: results.slice(0, 20) });
  }

  const { data, error } = importSchema.safeParse(body);
  if (error) return err("Validation failed", 400, error);

  const batch = await prisma.enterpriseImportBatch.create({
    data: { orgId: org.id, totalRows: data.rows.length, status: "PROCESSING" },
  });

  let imported = 0, skipped = 0, errors = 0;
  const errorLog = [];

  for (const rawRow of data.rows) {
    const parsed = rowSchema.safeParse(rawRow);
    if (!parsed.success) {
      errors++;
      errorLog.push({ email: rawRow.email || "", error: parsed.error.issues[0]?.message });
      continue;
    }
    const row = parsed.data;

    // Duplicate check within this org
    const existingInvite = await prisma.enterpriseHomeownerInvite.findFirst({
      where: { orgId: org.id, email: row.email },
    });
    if (existingInvite) { skipped++; continue; }

    // Validate optional installer attribution
    let invitedViaInstallerId = null;
    if (row.installer_id) {
      const approved = await prisma.enterpriseInstallerNetwork.findUnique({
        where: { orgId_installerId: { orgId: org.id, installerId: row.installer_id } },
      });
      if (approved?.status === "ADMIN_APPROVED") invitedViaInstallerId = row.installer_id;
    }

    const existingUser = await prisma.user.findUnique({ where: { email: row.email } });

    await prisma.enterpriseHomeownerInvite.create({
      data: {
        orgId:                org.id,
        email:                row.email,
        firstName:            row.first_name,
        lastName:             row.last_name,
        phone:                row.phone,
        address:              row.address,
        city:                 row.city,
        state:                row.state,
        zip:                  row.zip,
        systemType:           row.system_type,
        batterySystem:        ["yes","true","1","Yes"].includes(row.battery ?? ""),
        utility:              row.utility,
        invitedByUserId:      auth.user.id,
        invitedViaInstallerId,
        importBatchId:        batch.id,
        ...(data.campaignId && { campaignId: data.campaignId }),
        token:                uuid(),
        expiresAt:            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        // If they already have an account, mark as signed_up — no invite needed
        ...(existingUser && {
          homeownerUserId: existingUser.id,
          status:          "SIGNED_UP",
          signedUpAt:      new Date(),
        }),
      },
    }).catch(e => { errors++; errorLog.push({ email: row.email, error: e.message }); });

    imported++;
  }

  await prisma.enterpriseImportBatch.update({
    where: { id: batch.id },
    data:  { imported, skipped, errors, status: "COMPLETE", completedAt: new Date(), errorLog },
  });

  return ok({ batchId: batch.id, imported, skipped, errors, errorLog }, 201);
}
