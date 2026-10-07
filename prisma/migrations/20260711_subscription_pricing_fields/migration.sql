-- Migration: 20260711_subscription_pricing_fields
-- Adds 4-price subscription model and forecast mix assumptions to PlatformConfig.
-- NOTE: CreditRedemption already exists from 20260629_credit_economics — no changes needed.

-- Add subscription pricing fields to PlatformConfig
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "plusMonthly"   DOUBLE PRECISION NOT NULL DEFAULT 9.99;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "plusAnnual"    DOUBLE PRECISION NOT NULL DEFAULT 8.29;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "proMonthly"    DOUBLE PRECISION NOT NULL DEFAULT 19.99;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "proAnnual"     DOUBLE PRECISION NOT NULL DEFAULT 16.59;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "pctPlus"       DOUBLE PRECISION NOT NULL DEFAULT 0.70;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "pctAnnual"     DOUBLE PRECISION NOT NULL DEFAULT 0.30;
