import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";
import { getInstallerSuccessFeeRate } from "@/lib/platform-config.js";

const installerRegisterSchema = z.object({
  companyName:     z.string().min(2).max(200),
  licenseNumber:   z.string().min(3),
  nabcepCertified: z.boolean().default(false),
  street:          z.string(),
  city:            z.string(),
  state:           z.string().length(2),
  zip:             z.string().regex(/^\d{5}$/),
  serviceAreas:    z.array(z.string()).min(1).max(10),
  specialties:     z.array(z.string()).min(1),
  plan:            z.enum(["FREE","PRO","ENTERPRISE"]).default("FREE"),
  // Doc URLs uploaded to S3 first
  licenseDoc:      z.string().url().optional(),
  insuranceDoc:    z.string().url().optional(),
  workersCompDoc:  z.string().url().optional(),
  backgroundAuth:  z.string().url().optional(),
});


export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({
    where: { userId: auth.user.id },
  });
  return ok({ installer, hasAccount: !!installer });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (existing) return err("You already have an installer account.", 409);

  const { data, error } = await parseBody(request, installerRegisterSchema);
  if (error) return err("Validation failed", 400, error);

  const installer = await prisma.installer.create({
    data: {
      userId:            auth.user.id,
      companyName:       data.companyName,
      licenseNumber:     data.licenseNumber,
      nabcepCertified:   data.nabcepCertified,
      verificationStatus: "PENDING",
      plan:              data.plan,
      successFeeRate:    await getInstallerSuccessFeeRate(data.plan),
      serviceAreas:      data.serviceAreas,
      specialties:       data.specialties,
    },
  });

  await prisma.user.update({
    where: { id: auth.user.id },
    data:  { role: "INSTALLER" },
  });

  await prisma.notification.create({
    data: {
      userId:  auth.user.id,
      type:    "INSTALLER_REGISTERED",
      title:   "Application Submitted",
      message: `Your installer application for ${data.companyName} has been submitted. GridGuide will verify your license and insurance within 1–2 business days.`,
    },
  });

  return ok({ installer, message: "Installer application submitted." }, 201);
}
