-- Make InvitationDeliveryJob.campaignId nullable for standalone invites
ALTER TABLE "InvitationDeliveryJob" ALTER COLUMN "campaignId" DROP NOT NULL;

-- Drop old unique constraint (requires all three non-null)
ALTER TABLE "InvitationDeliveryJob" DROP CONSTRAINT IF EXISTS "InvitationDeliveryJob_invitationType_invitationId_campaignId_key";

-- Add partial index for deduplication when campaignId is set
CREATE UNIQUE INDEX IF NOT EXISTS "InvitationDeliveryJob_unique_with_campaign"
  ON "InvitationDeliveryJob"("invitationType","invitationId","campaignId")
  WHERE "campaignId" IS NOT NULL;
