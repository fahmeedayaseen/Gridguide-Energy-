/**
 * GET/PATCH /api/sellers/storefront
 *
 * Manages the co-branded storefront for Enterprise sellers.
 * The storefront is displayed at:
 *   marketplace.gridguide.ai/s/[storefrontSlug]  — always
 *   [customDomain]  — only if customDomainEnabled=true and approved by admin
 *
 * GridGuide branding is NOT removed. The storefront is co-branded:
 * "ABC Solar — Powered by GridGuide"
 * This keeps homeowners in the GridGuide ecosystem for VPP, rewards, and referrals.
 *
 * Enterprise plan only. Pro/Free sellers get a standard GridGuide storefront.
 */
import { prisma }              from "@/lib/db.js";
import { ok, err, parseBody }  from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z }                   from "zod";

const storefrontSchema = z.object({
  storefrontSlug:       z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only").optional(),
  storefrontLogoUrl:    z.string().url().optional().nullable(),
  storefrontBannerUrl:  z.string().url().optional().nullable(),
  storefrontBrandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color e.g. #00D4AA").optional().nullable(),
  storefrontTagline:    z.string().max(120).optional().nullable(),
  customDomain:         z.string().max(253).optional().nullable(), // admin must approve before enabling
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const seller = await prisma.seller.findUnique({
    where: { userId: auth.user.id },
    select: {
      plan: true, businessName: true,
      storefrontSlug: true, storefrontLogoUrl: true, storefrontBannerUrl: true,
      storefrontBrandColor: true, storefrontTagline: true,
      customDomain: true, customDomainEnabled: true, teamEnabled: true,
    },
  });
  if (!seller) return err("Seller account not found.", 404);

  return ok({
    seller,
    storefrontUrl: seller.storefrontSlug
      ? `https://marketplace.gridguide.ai/s/${seller.storefrontSlug}`
      : null,
    customDomainUrl: seller.customDomainEnabled && seller.customDomain
      ? `https://${seller.customDomain}`
      : null,
    enterprisePlanRequired: seller.plan !== "ENTERPRISE",
  });
}

export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller account not found.", 404);

  if (seller.plan !== "ENTERPRISE") {
    return err(
      "Custom branded storefronts are available on the Enterprise Seller plan. Upgrade to unlock this feature.",
      403,
      { upgradeRequired: true, requiredPlan: "ENTERPRISE" }
    );
  }

  const { data, error } = await parseBody(request, storefrontSchema);
  if (error) return err("Validation failed", 400, error);

  // Slug uniqueness check
  if (data.storefrontSlug && data.storefrontSlug !== seller.storefrontSlug) {
    const existing = await prisma.seller.findFirst({
      where: { storefrontSlug: data.storefrontSlug },
    });
    if (existing) return err(`The slug "${data.storefrontSlug}" is already taken. Choose a different one.`, 409);
  }

  // Custom domain changes require admin approval — clear the enabled flag
  // so the domain doesn't go live until an admin validates the CNAME and approves.
  const resetDomainApproval = data.customDomain && data.customDomain !== seller.customDomain;

  const updated = await prisma.seller.update({
    where: { id: seller.id },
    data: {
      ...data,
      ...(resetDomainApproval ? { customDomainEnabled: false } : {}),
    },
    select: {
      storefrontSlug: true, storefrontLogoUrl: true, storefrontBannerUrl: true,
      storefrontBrandColor: true, storefrontTagline: true,
      customDomain: true, customDomainEnabled: true,
    },
  });

  return ok({
    seller: updated,
    storefrontUrl: updated.storefrontSlug
      ? `https://marketplace.gridguide.ai/s/${updated.storefrontSlug}`
      : null,
    message: resetDomainApproval
      ? "Storefront updated. Your custom domain is pending admin approval before it goes live."
      : "Storefront updated successfully.",
  });
}
