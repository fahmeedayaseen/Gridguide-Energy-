-- SellerTeamRole enum
DO $$ BEGIN
  CREATE TYPE "SellerTeamRole" AS ENUM ('OWNER','MANAGER','SUPPORT','VIEWER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- SellerTeamMember
CREATE TABLE IF NOT EXISTS "SellerTeamMember" (
  "id"        TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sellerId"  TEXT NOT NULL REFERENCES "Seller"("id") ON DELETE CASCADE,
  "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "role"      "SellerTeamRole" NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'ACTIVE',
  "joinedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("sellerId","userId")
);
CREATE INDEX IF NOT EXISTS "SellerTeamMember_sellerId_role_idx" ON "SellerTeamMember"("sellerId","role");

-- SellerCustomer consent evidence
ALTER TABLE "SellerCustomer" ADD COLUMN IF NOT EXISTS "marketingConsentSource"    TEXT;
ALTER TABLE "SellerCustomer" ADD COLUMN IF NOT EXISTS "marketingConsentText"      TEXT;
ALTER TABLE "SellerCustomer" ADD COLUMN IF NOT EXISTS "marketingConsentIp"        TEXT;
ALTER TABLE "SellerCustomer" ADD COLUMN IF NOT EXISTS "marketingConsentRecordedBy" TEXT;
