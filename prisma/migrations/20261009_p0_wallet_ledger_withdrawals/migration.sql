-- P0 security & money paths (Oct 2026)
-- Applies on top of 0_init (the baseline generated from the pre-P0 schema).

-- ── Wallet ledger ──────────────────────────────────────────────────────────
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "idempotencyKey" TEXT,
    "externalRef" TEXT,
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");
CREATE INDEX "WalletTransaction_walletId_idx" ON "WalletTransaction"("walletId");
CREATE INDEX "WalletTransaction_userId_idx" ON "WalletTransaction"("userId");
CREATE INDEX "WalletTransaction_status_createdAt_idx" ON "WalletTransaction"("status", "createdAt");

ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Withdrawals: encrypted payout details + admin-controlled lifecycle ─────
ALTER TABLE "Withdrawal" ALTER COLUMN "status" SET DEFAULT 'PENDING_REVIEW';
ALTER TABLE "Withdrawal"
    ADD COLUMN "encryptedDestination" TEXT,
    ADD COLUMN "externalReference" TEXT,
    ADD COLUMN "failureReason" TEXT,
    ADD COLUMN "reviewedById" TEXT,
    ADD COLUMN "approvedAt" TIMESTAMP(3),
    ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE INDEX "Withdrawal_status_idx" ON "Withdrawal"("status");

-- Withdrawals created by the old flow sat in PROCESSING with their bank
-- details only in an unconsumed Redis queue. Move them to review so an admin
-- sees them; with no stored details they can only be failed (which refunds).
UPDATE "Withdrawal" SET "status" = 'PENDING_REVIEW' WHERE "status" = 'PROCESSING';

-- ── Installer success fees: one rate table (Free 10% · Pro 7% · Enterprise 5%)
ALTER TABLE "Installer" ALTER COLUMN "successFeeRate" SET DEFAULT 0.10;
ALTER TABLE "Job" ALTER COLUMN "successFeeRate" SET DEFAULT 0.10;

-- Re-sync each installer's stored display rate with its plan's configured rate.
UPDATE "Installer" i
   SET "successFeeRate" = CASE i."plan"
       WHEN 'PRO'        THEN COALESCE((SELECT "leadSuccessFeePro"        FROM "PlatformConfig" WHERE "id" = 'singleton'), 0.07)
       WHEN 'ENTERPRISE' THEN COALESCE((SELECT "leadSuccessFeeEnterprise" FROM "PlatformConfig" WHERE "id" = 'singleton'), 0.05)
       ELSE                   COALESCE((SELECT "leadSuccessFeeFree"       FROM "PlatformConfig" WHERE "id" = 'singleton'), 0.10)
   END;
