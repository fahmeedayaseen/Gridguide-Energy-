-- Refuse to roll back while withdrawals are mid-review: their money sits in pendingWithdrawals.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Withdrawal" WHERE "status" IN ('PENDING_REVIEW', 'PROCESSING')) THEN
    RAISE EXCEPTION 'Resolve PENDING_REVIEW/PROCESSING withdrawals before rolling back 20261009_p0_wallet_ledger_withdrawals';
  END IF;
END $$;
DROP TABLE IF EXISTS "WalletTransaction";
DROP INDEX IF EXISTS "Withdrawal_status_idx";
ALTER TABLE "Withdrawal"
    DROP COLUMN IF EXISTS "encryptedDestination",
    DROP COLUMN IF EXISTS "externalReference",
    DROP COLUMN IF EXISTS "failureReason",
    DROP COLUMN IF EXISTS "reviewedById",
    DROP COLUMN IF EXISTS "approvedAt",
    DROP COLUMN IF EXISTS "completedAt";
ALTER TABLE "Withdrawal" ALTER COLUMN "status" SET DEFAULT 'PROCESSING';
ALTER TABLE "Installer" ALTER COLUMN "successFeeRate" SET DEFAULT 0.05;
ALTER TABLE "Job" ALTER COLUMN "successFeeRate" SET DEFAULT 0.08;
