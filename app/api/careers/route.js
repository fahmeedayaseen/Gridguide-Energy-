/**
 * POST /api/careers — submit a job application (public, no auth required)
 * GET  /api/careers — list applications (admin only)
 */
import { prisma }             from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole }        from "@/lib/jwt.js";
import { z }                  from "zod";

const applySchema = z.object({
  role:        z.string().min(2).max(200),
  name:        z.string().min(2).max(120),
  email:       z.string().email(),
  phone:       z.string().max(30).optional(),
  linkedin:    z.string().url().optional().or(z.literal("")),
  resumeUrl:   z.string().url().optional().or(z.literal("")),
  coverLetter: z.string().max(5000).optional(),
  source:      z.string().max(100).optional(),
});

// Public — anyone can submit an application
export async function POST(request) {
  const { data, error } = await parseBody(request, applySchema);
  if (error) return err("Validation failed", 400, error);

  // Duplicate check — same email + same role within 30 days
  const recent = await prisma.jobApplication.findFirst({
    where: {
      email: data.email.toLowerCase(),
      role:  data.role,
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
  });
  if (recent) {
    return err("An application for this role from this email was already submitted recently. We'll be in touch.", 409);
  }

  const application = await prisma.jobApplication.create({
    data: {
      ...data,
      email:    data.email.toLowerCase(),
      linkedin: data.linkedin || null,
      resumeUrl: data.resumeUrl || null,
      coverLetter: data.coverLetter || null,
      source:   data.source || null,
      status:   "NEW",
    },
  });

  return ok({
    application: { id: application.id, role: application.role, name: application.name },
    message: "Application received. We'll review it and reach out if there's a match.",
  }, 201);
}

// Admin only — view all applications
export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const role   = searchParams.get("role");

  const applications = await prisma.jobApplication.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(role   ? { role: { contains: role, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return ok({ applications, total: applications.length });
}
