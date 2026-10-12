-- Create shared CampaignStatus enum
DO $$ BEGIN
  CREATE TYPE "CampaignStatus" AS ENUM (
    'DRAFT','SCHEDULED','QUEUED','SENDING','SENT','PARTIAL','FAILED','PAUSED','CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Migrate InstallerCampaign to typed enum
ALTER TABLE "InstallerCampaign"
  ALTER COLUMN "status" TYPE "CampaignStatus"
  USING "status"::"CampaignStatus";
ALTER TABLE "InstallerCampaign" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"CampaignStatus";

-- Migrate EnterpriseCampaign to typed enum
ALTER TABLE "EnterpriseCampaign"
  ALTER COLUMN "status" TYPE "CampaignStatus"
  USING "status"::"CampaignStatus";
ALTER TABLE "EnterpriseCampaign" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"CampaignStatus";
