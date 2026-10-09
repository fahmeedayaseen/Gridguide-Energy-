-- Community Impact page: public donation transparency, fundraising goal,
-- and funded-project tracking with receipts.

ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "publicDonationCounterEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "donationDisplayMode" TEXT NOT NULL DEFAULT 'campaign';
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "communityGoalLabel" TEXT NOT NULL DEFAULT 'Community Donation Goal';
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "communityGoalTargetAmount" DOUBLE PRECISION NOT NULL DEFAULT 100000;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "communityGoalStartDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "CommunityFundProject" (
  "id"              TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "description"     TEXT NOT NULL,
  "amountFunded"    DOUBLE PRECISION NOT NULL,
  "recipientName"   TEXT,
  "receiptUrl"      TEXT,
  "fundedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isPublished"     BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityFundProject_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CommunityFundProject_isPublished_idx" ON "CommunityFundProject"("isPublished");
CREATE INDEX IF NOT EXISTS "CommunityFundProject_fundedAt_idx" ON "CommunityFundProject"("fundedAt");
