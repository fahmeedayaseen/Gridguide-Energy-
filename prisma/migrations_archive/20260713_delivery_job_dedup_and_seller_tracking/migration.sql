-- Seller communication delivery tracking and campaign reporting.
ALTER TABLE "SellerTeamInvite"
  ADD COLUMN IF NOT EXISTS "sendAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastSendError" TEXT,
  ADD COLUMN IF NOT EXISTS "providerId" TEXT;

ALTER TABLE "SellerCampaign"
  ADD COLUMN IF NOT EXISTS "suppressedCount" INTEGER NOT NULL DEFAULT 0;

-- One delivery job per campaign recipient.
CREATE UNIQUE INDEX IF NOT EXISTS
  "InvitationDeliveryJob_campaign_unique"
ON "InvitationDeliveryJob"
  ("invitationType", "invitationId", "campaignId")
WHERE "campaignId" IS NOT NULL;

-- Prevent duplicate active standalone jobs, while allowing a later resend after completion.
CREATE UNIQUE INDEX IF NOT EXISTS
  "InvitationDeliveryJob_standalone_active_unique"
ON "InvitationDeliveryJob"
  ("invitationType", "invitationId")
WHERE "campaignId" IS NULL
  AND "status" IN ('PENDING', 'QUEUED', 'SENDING');
