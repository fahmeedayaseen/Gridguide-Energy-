-- Migration: 20260712_invite_failure_tracking
-- Adds failure tracking to InstallerCustomerInvite and campaign models.

ALTER TABLE "InstallerCustomerInvite" ADD COLUMN IF NOT EXISTS "sendAttempts"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InstallerCustomerInvite" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "InstallerCustomerInvite" ADD COLUMN IF NOT EXISTS "lastSendError" TEXT;

ALTER TABLE "InstallerCampaign" ADD COLUMN IF NOT EXISTS "failedCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "EnterpriseCampaign" ADD COLUMN IF NOT EXISTS "failedCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "sendAttempts"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "lastSendError" TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "firstName"     TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "lastName"      TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "phone"         TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "address"       TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "city"          TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "state"         TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "zip"           TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "systemType"    TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "batterySystem" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "utility"       TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "propertyId"    TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "importBatchId" TEXT REFERENCES "EnterpriseImportBatch"("id");
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "campaignId"    TEXT REFERENCES "EnterpriseCampaign"("id");
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "sentAt"        TIMESTAMP(3);
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "openedAt"      TIMESTAMP(3);
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "clickedAt"     TIMESTAMP(3);
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "signedUpAt"    TIMESTAMP(3);
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "subscribedAt"  TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "EnterpriseHomeownerInvite_importBatchId_idx" ON "EnterpriseHomeownerInvite"("importBatchId");
