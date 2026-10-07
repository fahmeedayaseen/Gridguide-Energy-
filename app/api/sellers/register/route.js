import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { sendVerificationEmail } from "@/lib/email.js";
import { z } from "zod";

const sellerRegisterSchema = z.object({
  businessName:  z.string().min(2).max(200),
  category:      z.enum(["Solar","Battery Storage","EV Charging","Smart Panel","Monitoring","Hardware","Accessories","Multiple Categories"]),
  description:   z.string().max(2000).optional(),
  website:       z.string().url().optional(),
  street:        z.string(),
  city:          z.string(),
  state:         z.string().length(2),
  zip:           z.string().regex(/^\d{5}$/),
  taxId:         z.string().optional(),
  licenseNumber: z.string().optional(),
  // Document URLs (uploaded to S3 via /api/upload before this call)
  licenseDoc:    z.string().url().optional(),
  taxDoc:        z.string().url().optional(),
});

// GET /api/sellers/register — check if user already has a seller account
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const seller = await prisma.seller.findUnique({
    where: { userId: auth.user.id },
    include: { products: { select: { id: true }, take: 1 } },
  });

  return ok({ seller, hasAccount: !!seller });
}

// POST /api/sellers/register — create seller account
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  // One seller account per user
  const existing = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (existing) return err("You already have a seller account.", 409);

  const { data, error } = await parseBody(request, sellerRegisterSchema);
  if (error) return err("Validation failed", 400, error);

  const seller = await prisma.seller.create({
    data: {
      userId:            auth.user.id,
      businessName:      data.businessName,
      category:          data.category,
      description:       data.description,
      website:           data.website,
      licenseNumber:     data.licenseNumber,
      taxId:             data.taxId,
      verificationStatus: "PENDING",
      plan:              "FREE",
      commissionRate:    0.10,
    },
  });

  // Update user role to SELLER
  await prisma.user.update({
    where: { id: auth.user.id },
    data:  { role: "SELLER" },
  });

  // Notify admin (in production, create an admin notification)
  await prisma.notification.create({
    data: {
      userId:  auth.user.id,
      type:    "SELLER_REGISTERED",
      title:   "Seller Account Submitted",
      message: `Your seller account for ${data.businessName} has been submitted for review. You'll receive an email within 1–2 business days.`,
    },
  });

  return ok({ seller, message: "Seller account submitted for review." }, 201);
}
