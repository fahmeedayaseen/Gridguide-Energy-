-- Installer referral verification. Closes a real revenue-share fraud gap:
-- self-reported referrals (manual add or bulk import) had no proof
-- requirement and could earn real commission the moment the claimed
-- homeowner upgraded their subscription for any unrelated reason.

ALTER TABLE "InstallerReferral" ADD COLUMN IF NOT EXISTS "verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InstallerReferral" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);
ALTER TABLE "InstallerReferral" ADD COLUMN IF NOT EXISTS "verifiedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "InstallerReferral_verified_idx" ON "InstallerReferral"("verified");

-- Existing rows created via the real signup-with-code flow (sourceType =
-- 'signup') are retroactively marked verified - that path has always had
-- real proof (the referral code itself, used at account creation). Rows
-- from self-reported paths (import/qr_code/link) remain unverified until
-- the homeowner confirms or an admin approves, exactly as new rows will
-- from this point forward.
UPDATE "InstallerReferral" SET "verified" = true, "verifiedAt" = "referredAt" WHERE "sourceType" = 'signup';
