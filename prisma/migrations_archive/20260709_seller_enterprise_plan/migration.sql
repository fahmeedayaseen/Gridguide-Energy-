-- GridGuide Seller — Enterprise plan and co-branded storefront fields
-- Migration: 20260709_seller_enterprise_plan
--
-- Adds ENTERPRISE to the SellerPlan enum and new co-branded storefront
-- fields to the Seller model. The storefront is co-branded ("ABC Solar —
-- Powered by GridGuide"), not a full white-label — GridGuide branding
-- is retained to preserve the ecosystem and VPP/rewards upsell path.

-- Add ENTERPRISE to the enum (Postgres requires recreating the type)
ALTER TYPE "SellerPlan" ADD VALUE IF NOT EXISTS 'ENTERPRISE';

-- Co-branded storefront fields
ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "storefrontSlug"       TEXT UNIQUE;
ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "storefrontLogoUrl"    TEXT;
ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "storefrontBannerUrl"  TEXT;
ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "storefrontBrandColor" TEXT;
ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "storefrontTagline"    TEXT;
ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "customDomainEnabled"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "customDomain"         TEXT;
ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "teamEnabled"          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT;

-- Update commission rate comment (10% Free, 7% Pro, 5% Enterprise)
-- Rates are enforced in application code, not in the DB column itself.
