-- Installer plan economics normalization.
--
-- New installers previously defaulted to successFeeRate 0.05 (the Enterprise
-- rate) and vppSharePct 0.05 (the Pro VPP share), so every Free installer was
-- undercharged on lead success fees and over-credited on VPP revenue. Plans
-- granted without payment (self-upgrade via /api/installers/membership or
-- picking PRO/ENTERPRISE at registration) are NOT reverted here — review those
-- manually against Stripe before deploying (see query at the bottom).

ALTER TABLE "Installer" ALTER COLUMN "successFeeRate" SET DEFAULT 0.10;
ALTER TABLE "Installer" ALTER COLUMN "vppSharePct"    SET DEFAULT 0;
ALTER TABLE "Job"       ALTER COLUMN "successFeeRate" SET DEFAULT 0.10;

-- Bring every installer's stored rates in line with their plan (default
-- PlatformConfig values; lib/installer-plans.js re-applies admin-configured
-- values on the next plan change).
UPDATE "Installer" SET "successFeeRate" = 0.10, "vppSharePct" = 0,    "revenueSharePct" = 0.15 WHERE "plan" = 'FREE';
UPDATE "Installer" SET "successFeeRate" = 0.07, "vppSharePct" = 0.05, "revenueSharePct" = 0.25 WHERE "plan" = 'PRO';
UPDATE "Installer" SET "successFeeRate" = 0.05, "vppSharePct" = 0.10, "revenueSharePct" = 0.30 WHERE "plan" = 'ENTERPRISE';

-- Manual review (not executed): paid-plan installers with no Stripe subscription.
-- SELECT id, "companyName", plan, "membershipStatus" FROM "Installer"
--   WHERE plan IN ('PRO','ENTERPRISE') AND "stripeSubscriptionId" IS NULL;
