-- GridGuide VPP Revenue Split — per installer plan tier
-- Migration: 20260630_vpp_tiered_split
--
-- Replaces the old flat vppGridguideFee / vppHomeownerShare / vppInstallerBonus
-- fields with a 3-way split defined per installer plan tier (Free/Pro/Enterprise),
-- so each tier's row sums to 100%:
--   Free:       80% homeowner / 20% GridGuide /  0% installer
--   Pro:        75% homeowner / 20% GridGuide /  5% installer
--   Enterprise: 75% homeowner / 15% GridGuide / 10% installer

ALTER TABLE "PlatformConfig" DROP COLUMN IF EXISTS "vppGridguideFee";
ALTER TABLE "PlatformConfig" DROP COLUMN IF EXISTS "vppHomeownerShare";
ALTER TABLE "PlatformConfig" DROP COLUMN IF EXISTS "vppInstallerBonus";

ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "vppSplitFreeHomeowner"       DOUBLE PRECISION NOT NULL DEFAULT 0.80;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "vppSplitFreeGridguide"       DOUBLE PRECISION NOT NULL DEFAULT 0.20;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "vppSplitFreeInstaller"       DOUBLE PRECISION NOT NULL DEFAULT 0.00;

ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "vppSplitProHomeowner"        DOUBLE PRECISION NOT NULL DEFAULT 0.75;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "vppSplitProGridguide"        DOUBLE PRECISION NOT NULL DEFAULT 0.20;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "vppSplitProInstaller"        DOUBLE PRECISION NOT NULL DEFAULT 0.05;

ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "vppSplitEnterpriseHomeowner" DOUBLE PRECISION NOT NULL DEFAULT 0.75;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "vppSplitEnterpriseGridguide" DOUBLE PRECISION NOT NULL DEFAULT 0.15;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "vppSplitEnterpriseInstaller" DOUBLE PRECISION NOT NULL DEFAULT 0.10;
