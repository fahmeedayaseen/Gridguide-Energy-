-- Proposal delivery: secure, expiring view link emailed to the homeowner.
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "viewToken" TEXT;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "viewTokenExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Proposal_viewToken_key" ON "Proposal"("viewToken");
