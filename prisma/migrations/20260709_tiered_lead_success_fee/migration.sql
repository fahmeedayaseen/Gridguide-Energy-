-- GridGuide Installer — Tiered Lead Success Fee by Plan
-- Migration: 20260709_tiered_lead_success_fee
--
-- Adds successFeeRate to Job so each record carries an audit trail of which
-- plan-tier rate applied at the time of job creation:
--   Free:       8%  (leadSuccessFee: 0.08)
--   Pro:        5%  (leadSuccessFee: 0.05)
--   Enterprise: 3%  (leadSuccessFee: 0.03)
--
-- Self-sourced jobs (no leadId) always have successFee=0 and successFeeRate=0.
-- Only GridGuide-generated leads incur a success fee.

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "successFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0.08;

-- Add admin-adjustable lead success fee fields to PlatformConfig
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "leadSuccessFeeFree"       DOUBLE PRECISION NOT NULL DEFAULT 0.10;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "leadSuccessFeePro"        DOUBLE PRECISION NOT NULL DEFAULT 0.07;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "leadSuccessFeeEnterprise" DOUBLE PRECISION NOT NULL DEFAULT 0.05;
