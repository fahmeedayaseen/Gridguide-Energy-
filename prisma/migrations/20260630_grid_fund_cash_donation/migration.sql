-- GridGuide Community Fund — donations now come from CASH wallet, not Credits
-- Migration: 20260630_grid_fund_cash_donation
--
-- Donations to the GridGuide Community Fund are now sourced from the
-- homeowner's cash wallet (VPP earnings), not their Credits balance. The
-- homeowner earns 10% of the donated dollar value back as GridGuide Credits.

ALTER TABLE "GridFundDonation" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'cash_wallet';
ALTER TABLE "GridFundDonation" ADD COLUMN IF NOT EXISTS "creditBonusAwarded" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "GridFundDonation_userId_idx" ON "GridFundDonation"("userId");

-- Retire the old credit-based minimum/bonus fields on PlatformConfig — donation
-- minimum and bonus rate are now expressed in dollar terms (see lib/wallet.js)
COMMENT ON COLUMN "PlatformConfig"."gridFundDonationMinCredits" IS 'DEPRECATED — donations now sourced from cash wallet, see gridFundDonationMinDollars / gridFundDonationBonusPct';
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "gridFundDonationMinDollars" DOUBLE PRECISION NOT NULL DEFAULT 1.00;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "gridFundDonationBonusPct"   DOUBLE PRECISION NOT NULL DEFAULT 0.10;
