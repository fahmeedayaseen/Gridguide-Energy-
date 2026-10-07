-- GridGuide Community Solar Fund — donation minimum and bonus-back
-- Migration: 20260630_grid_fund_donation
--
-- Adds admin-adjustable minimum donation (default 1,000 credits = $1.00)
-- and bonus credits awarded back to the homeowner per donation (default 25).

ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "gridFundDonationMinCredits"   INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "gridFundDonationBonusCredits" INTEGER NOT NULL DEFAULT 25;
