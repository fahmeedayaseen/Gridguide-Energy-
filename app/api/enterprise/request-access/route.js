/**
 * POST /api/enterprise/request-access
 * Public form submission from the GridGuide Business landing page.
 * Creates an EnterpriseRequest for the admin team to review and follow up.
 */
import { prisma }            from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { rateLimit }         from "@/lib/redis.js";
import { sendEmail }         from "@/lib/email.js";
import { z }                 from "zod";

const schema = z.object({
  orgName:       z.string().min(1).max(150),
  contactName:   z.string().min(1).max(100),
  email:         z.string().email(),
  phone:         z.string().optional(),
  propertyCount: z.union([z.string(), z.number()]).optional(),
  orgType:       z.string().default("Property Management"),
});

export async function POST(request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const { allowed } = await rateLimit(`ent-request:${ip}`, 5, 3600);
  if (!allowed) return err("Too many requests. Please try again later.", 429);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const propertyCount = data.propertyCount ? parseInt(data.propertyCount, 10) : null;

  const reqRow = await prisma.enterpriseRequest.create({
    data: {
      orgName:       data.orgName,
      contactName:   data.contactName,
      email:         data.email,
      phone:         data.phone || null,
      propertyCount: Number.isFinite(propertyCount) ? propertyCount : null,
      orgType:       data.orgType,
      status:        "pending",
    },
  });

  // Notify the GridGuide sales team
  sendEmail({
    to:      process.env.SALES_NOTIFY_EMAIL || "sales@gridguide.ai",
    subject: `New GridGuide Business request: ${data.orgName}`,
    text:    `${data.contactName} (${data.email}) from ${data.orgName} requested access.\n\nType: ${data.orgType}\nProperties: ${propertyCount || "not specified"}\nPhone: ${data.phone || "not provided"}`,
  }).catch(e => console.error("[EnterpriseRequest] Notify email failed:", e.message));

  // Confirmation email to the requester
  sendEmail({
    to:      data.email,
    subject: "We received your GridGuide Business request",
    text:    `Hi ${data.contactName},\n\nThanks for your interest in GridGuide Business. Our team will reach out within one business day to set up your account.\n\n— GridGuide`,
  }).catch(() => {});

  return ok({
    message: "Request received. Our team will reach out within one business day.",
    requestId: reqRow.id,
  }, 201);
}
