-- Migration: 20260712_enterprise_referral_import
-- Extends EnterpriseHomeownerInvite with funnel tracking, bulk import,
-- and campaign support. Adds EnterpriseImportBatch and EnterpriseCampaign.

-- EnterpriseImportBatch
CREATE TABLE IF NOT EXISTS "EnterpriseImportBatch" (
  "id"          TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orgId"       TEXT NOT NULL REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE,
  "fileName"    TEXT,
  "totalRows"   INTEGER NOT NULL DEFAULT 0,
  "imported"    INTEGER NOT NULL DEFAULT 0,
  "skipped"     INTEGER NOT NULL DEFAULT 0,
  "errors"      INTEGER NOT NULL DEFAULT 0,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "errorLog"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "EnterpriseImportBatch_orgId_idx" ON "EnterpriseImportBatch"("orgId");

-- EnterpriseCampaign
CREATE TABLE IF NOT EXISTS "EnterpriseCampaign" (
  "id"          TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orgId"       TEXT NOT NULL REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE,
  "name"        TEXT NOT NULL,
  "subject"     TEXT NOT NULL,
  "body"        TEXT,
  "status"      TEXT NOT NULL DEFAULT 'DRAFT',
  "sentCount"   INTEGER NOT NULL DEFAULT 0,
  "openCount"   INTEGER NOT NULL DEFAULT 0,
  "clickCount"  INTEGER NOT NULL DEFAULT 0,
  "signupCount" INTEGER NOT NULL DEFAULT 0,
  "scheduledAt" TIMESTAMP(3),
  "sentAt"      TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "EnterpriseCampaign_orgId_idx" ON "EnterpriseCampaign"("orgId");

-- Extend EnterpriseHomeownerInvite
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "firstName"        TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "lastName"         TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "phone"            TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "address"          TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "city"             TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "state"            TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "zip"              TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "systemType"       TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "batterySystem"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "utility"          TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "propertyId"       TEXT;
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "importBatchId"    TEXT REFERENCES "EnterpriseImportBatch"("id");
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "campaignId"       TEXT REFERENCES "EnterpriseCampaign"("id");
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "sentAt"           TIMESTAMP(3);
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "openedAt"         TIMESTAMP(3);
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "clickedAt"        TIMESTAMP(3);
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "signedUpAt"       TIMESTAMP(3);
ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "subscribedAt"     TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "EnterpriseHomeownerInvite_importBatchId_idx" ON "EnterpriseHomeownerInvite"("importBatchId");
