-- Phase 5: real multi-user Enterprise access. Existing EnterpriseTeamMember
-- rows are roster entries with no login (userId NULL) - they remain valid
-- and simply can't authenticate until individually re-invited through the
-- new accept flow. No forced backfill.

ALTER TABLE "EnterpriseTeamMember" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "EnterpriseTeamMember" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "EnterpriseTeamMember" ADD COLUMN IF NOT EXISTS "inviteToken" TEXT;
ALTER TABLE "EnterpriseTeamMember" ADD COLUMN IF NOT EXISTS "inviteExpiresAt" TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "EnterpriseTeamMember" ADD CONSTRAINT "EnterpriseTeamMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "EnterpriseTeamMember_inviteToken_key" ON "EnterpriseTeamMember"("inviteToken");
CREATE INDEX IF NOT EXISTS "EnterpriseTeamMember_userId_idx" ON "EnterpriseTeamMember"("userId");
CREATE INDEX IF NOT EXISTS "EnterpriseTeamMember_inviteToken_idx" ON "EnterpriseTeamMember"("inviteToken");
