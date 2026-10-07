/**
 * GET    /api/installers/certifications       — list certifications
 * POST   /api/installers/certifications       — add certification
 * DELETE /api/installers/certifications?id=   — remove certification
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const createSchema = z.object({
  name:        z.string().min(1),
  issuer:      z.string().min(1),
  issuedAt:    z.string().optional(),
  expiresAt:   z.string().optional(),
  documentUrl: z.string().url().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);
  const certs = await prisma.installerCertification.findMany({
    where: { installerId: installer.id },
    orderBy: { createdAt: "desc" },
  });
  return ok({ certifications: certs });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);
  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);
  const cert = await prisma.installerCertification.create({
    data: {
      installerId: installer.id,
      name:        data.name,
      issuer:      data.issuer,
      issuedAt:    data.issuedAt  ? new Date(data.issuedAt)  : null,
      expiresAt:   data.expiresAt ? new Date(data.expiresAt) : null,
      documentUrl: data.documentUrl,
      status:      "pending",
    },
  });
  return ok({ certification: cert, message: "Certification submitted for review." }, 201);
}

export async function DELETE(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const { searchParams } = new URL(request.url);
  const certId = searchParams.get("id");
  if (!certId) return err("Certification ID required", 400);
  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);
  const cert = await prisma.installerCertification.findFirst({ where: { id: certId, installerId: installer.id } });
  if (!cert) return err("Certification not found", 404);
  await prisma.installerCertification.delete({ where: { id: certId } });
  return ok({ message: "Certification removed." });
}
