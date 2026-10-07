import { parseCustomerCsv, validateCustomerRows } from "@/lib/csv.js";
/**
 * POST /api/installers/import   — CSV/JSON bulk customer import
 * GET  /api/installers/import   — list import batches
 *
 * P1 fix: imported count only increments AFTER a successful DB write.
 * Uses PapaParse-compatible row format (header:true) — frontend should
 * parse CSV client-side with PapaParse and POST the resulting row array.
 */
import { prisma }              from "@/lib/db.js";
import { ok, err, parseBody }  from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z }                   from "zod";
import { nanoid }              from "nanoid";

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
  installation_date: z.string().optional(),
});

const importSchema = z.object({
  rows:       z.array(z.record(z.string())).max(5000),
  campaignId: z.string().optional(),
  preview:    z.boolean().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer account not found", 404);

  const batches = await prisma.installerImportBatch.findMany({
    where:   { installerId: installer.id },
    orderBy: { createdAt: "desc" },
    take:    50,
    include: { _count: { select: { invites: true } } },
  });

  return ok({ batches });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer account not found", 404);

  const body = await request.json().catch(() => null);
  if (!body) return err("Invalid JSON body", 400);

  // Preview mode — validate without writing
  if (body.preview === true) {
    const rows   = body.rows ?? [];
    const valid  = [];
    const invalid= [];
    for (let i = 0; i < Math.min(rows.length, 5000); i++) {
      const parsed = rowSchema.safeParse(rows[i]);
      if (parsed.success) valid.push({ row: i+1, email: parsed.data.email });
      else invalid.push({ row: i+1, email: rows[i].email||"", error: parsed.error.issues[0]?.message });
    }
    return ok({ preview: true, total: rows.length, valid: valid.length, invalid });
  }

  const { data, error } = importSchema.safeParse(body);
  if (error) return err("Validation failed", 400, error);

  // Ensure referral code
  if (!installer.referralCode) {
    await prisma.installer.update({
      where: { id: installer.id },
      data:  { referralCode: `GG-${installer.id.slice(-6).toUpperCase()}` },
    });
  }

  const batch = await prisma.installerImportBatch.create({
    data: { installerId: installer.id, totalRows: data.rows.length, status: "PROCESSING" },
  });

  let imported = 0, skipped = 0, errors = 0;
  const errorLog = [];

  for (const rawRow of data.rows) {
    const parsed = rowSchema.safeParse(rawRow);
    if (!parsed.success) {
      errors++;
      errorLog.push({ email: rawRow.email||"", error: parsed.error.issues[0]?.message });
      continue;
    }
    const row = parsed.data;

    // Duplicate check within this installer
    const dup = await prisma.installerCustomerInvite.findFirst({
      where: { installerId: installer.id, email: row.email },
    });
    if (dup) { skipped++; continue; }

    const existingUser = await prisma.user.findUnique({ where: { email: row.email } });

    if (existingUser) {
      // Existing member — create unverified referral
      const alreadyLinked = await prisma.installerReferral.findUnique({
        where: { installerId_userId: { installerId: installer.id, userId: existingUser.id } },
      });
      if (!alreadyLinked) {
        const created = await prisma.installerReferral.create({
          data: {
            installerId:      installer.id,
            userId:           existingUser.id,
            referralCode:     installer.referralCode || "",
            sourceType:       "import",
            userPlan:         existingUser.plan,
            conversionStatus: "referred",
            verified:         false,
          },
        }).then(() => true).catch(() => false);

        if (created) {
          await prisma.notification.create({
            data: {
              userId:  existingUser.id,
              type:    "INSTALLER_REFERRAL_CLAIMED",
              title:   `${installer.companyName} added you as their customer`,
              message: "Confirm this in your account settings if correct.",
              data:    { installerId: installer.id },
            },
          }).catch(() => {});
          // P1 fix: only increment after confirmed write
          imported++;
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    } else {
      // Non-member — create invite
      const created = await prisma.installerCustomerInvite.create({
        data: {
          installerId:   installer.id,
          email:         row.email,
          firstName:     row.first_name,
          lastName:      row.last_name,
          phone:         row.phone,
          address:       row.address,
          city:          row.city,
          state:         row.state,
          zip:           row.zip,
          systemType:    row.system_type,
          batterySystem: ["yes","true","1","Yes"].includes(row.battery ?? ""),
          utility:       row.utility,
          inviteToken:   nanoid(32),
          importBatchId: batch.id,
          ...(data.campaignId && { campaignId: data.campaignId }),
        },
      }).then(r => r).catch(e => { errorLog.push({ email: row.email, error: e.message }); return null; });

      // P1 fix: only count if insert succeeded
      if (created) imported++;
      else errors++;
    }
  }

  await prisma.installerImportBatch.update({
    where: { id: batch.id },
    data:  { imported, skipped, errors, status: "COMPLETE", completedAt: new Date(), errorLog },
  });

  if (imported > 0) {
    await prisma.installer.update({
      where: { id: installer.id },
      data:  { totalReferredUsers: { increment: imported } },
    });
  }

  return ok({ batchId: batch.id, imported, skipped, errors, errorLog }, 201);
}
