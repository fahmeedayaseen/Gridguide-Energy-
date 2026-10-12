-- Migration: 20260712_suppression_delivery_queue
-- Adds: EmailSuppression, UnsubscribeToken, InvitationDeliveryJob
-- Adds: campaign queueing lifecycle fields
-- Adds: EnterpriseHomeownerInvite.clickedAt

CREATE TABLE IF NOT EXISTS "EmailSuppression" (
  "id"        TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "email"     TEXT NOT NULL UNIQUE,
  "reason"    TEXT NOT NULL,
  "source"    TEXT,
  "metadata"  JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "EmailSuppression_email_idx" ON "EmailSuppression"("email");

CREATE TABLE IF NOT EXISTS "UnsubscribeToken" (
  "id"        TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "email"     TEXT NOT NULL,
  "token"     TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "UnsubscribeToken_email_idx"  ON "UnsubscribeToken"("email");
CREATE INDEX IF NOT EXISTS "UnsubscribeToken_token_idx"  ON "UnsubscribeToken"("token");

CREATE TABLE IF NOT EXISTS "InvitationDeliveryJob" (
  "id"             TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "invitationType" TEXT NOT NULL,
  "invitationId"   TEXT NOT NULL,
  "campaignId"     TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "lastError"      TEXT,
  "providerId"     TEXT,
  "availableAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("invitationType","invitationId","campaignId")
);
CREATE INDEX IF NOT EXISTS "InvitationDeliveryJob_status_availableAt_idx" ON "InvitationDeliveryJob"("status","availableAt");
CREATE INDEX IF NOT EXISTS "InvitationDeliveryJob_campaignId_idx"         ON "InvitationDeliveryJob"("campaignId");
CREATE INDEX IF NOT EXISTS "InvitationDeliveryJob_recipientEmail_idx"     ON "InvitationDeliveryJob"("recipientEmail");

-- Campaign lifecycle fields
ALTER TABLE "InstallerCampaign"  ADD COLUMN IF NOT EXISTS "queuedAt"    TIMESTAMP(3);
ALTER TABLE "InstallerCampaign"  ADD COLUMN IF NOT EXISTS "startedAt"   TIMESTAMP(3);
ALTER TABLE "InstallerCampaign"  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "InstallerCampaign"  ADD COLUMN IF NOT EXISTS "failedAt"    TIMESTAMP(3);

ALTER TABLE "EnterpriseCampaign" ADD COLUMN IF NOT EXISTS "queuedAt"    TIMESTAMP(3);
ALTER TABLE "EnterpriseCampaign" ADD COLUMN IF NOT EXISTS "startedAt"   TIMESTAMP(3);
ALTER TABLE "EnterpriseCampaign" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "EnterpriseCampaign" ADD COLUMN IF NOT EXISTS "failedAt"    TIMESTAMP(3);

ALTER TABLE "EnterpriseHomeownerInvite" ADD COLUMN IF NOT EXISTS "clickedAt" TIMESTAMP(3);
