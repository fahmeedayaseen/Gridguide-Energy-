-- Migrate SellerTeamInvite.role from String to SellerTeamRole enum
ALTER TABLE "SellerTeamInvite"
  ALTER COLUMN "role" TYPE "SellerTeamRole"
  USING "role"::"SellerTeamRole";
ALTER TABLE "SellerTeamInvite" ALTER COLUMN "role" SET DEFAULT 'VIEWER'::"SellerTeamRole";
