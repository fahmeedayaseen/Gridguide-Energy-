-- GridGuide Credit Economics & Installer Commission Ledger
-- Migration: 20260629_credit_economics

-- ── Update PlatformConfig: replace points-based fields with credit economics ──
ALTER TABLE "PlatformConfig" DROP COLUMN IF EXISTS "homeownerReferralSignupPts";
ALTER TABLE "PlatformConfig" DROP COLUMN IF EXISTS "homeownerReferralSubPts";
ALTER TABLE "PlatformConfig" DROP COLUMN IF EXISTS "homeownerReferralCredit";

ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "creditsPerDollar" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "homeownerReferralCredits" INTEGER NOT NULL DEFAULT 2500;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "monthlyRedemptionCapCredits" INTEGER NOT NULL DEFAULT 2500;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "monthlyRedemptionCapDollars" DOUBLE PRECISION NOT NULL DEFAULT 2.50;
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "homeownerSubscriptionPrice" DOUBLE PRECISION NOT NULL DEFAULT 9.99;

-- ── CreditAccount: the credit-based rewards wallet ─────────────────────────────
CREATE TABLE "CreditAccount" (
    "id"                TEXT NOT NULL,
    "userId"            TEXT NOT NULL,
    "balance"           INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned"    INTEGER NOT NULL DEFAULT 0,
    "lifetimeRedeemed"  INTEGER NOT NULL DEFAULT 0,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CreditAccount_userId_key" ON "CreditAccount"("userId");
CREATE INDEX "CreditAccount_userId_idx" ON "CreditAccount"("userId");
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── CreditTransaction: ledger of every credit earn / redeem ────────────────────
CREATE TABLE "CreditTransaction" (
    "id"              TEXT NOT NULL,
    "creditAccountId" TEXT NOT NULL,
    "amount"          INTEGER NOT NULL,
    "reason"          TEXT NOT NULL,
    "metadata"        JSONB,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CreditTransaction_creditAccountId_idx" ON "CreditTransaction"("creditAccountId");
CREATE INDEX "CreditTransaction_reason_idx" ON "CreditTransaction"("reason");
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_creditAccountId_fkey"
    FOREIGN KEY ("creditAccountId") REFERENCES "CreditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── CreditRedemption: monthly redemption toward subscription (enforces cap) ────
CREATE TABLE "CreditRedemption" (
    "id"                  TEXT NOT NULL,
    "userId"              TEXT NOT NULL,
    "creditAccountId"     TEXT NOT NULL,
    "periodMonth"         INTEGER NOT NULL,
    "periodYear"          INTEGER NOT NULL,
    "creditsRedeemed"     INTEGER NOT NULL,
    "dollarValue"         DOUBLE PRECISION NOT NULL,
    "appliedTo"           TEXT NOT NULL DEFAULT 'subscription',
    "stripeInvoiceItemId" TEXT,
    "status"              TEXT NOT NULL DEFAULT 'APPLIED',
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditRedemption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CreditRedemption_userId_periodMonth_periodYear_key"
    ON "CreditRedemption"("userId", "periodMonth", "periodYear");
CREATE INDEX "CreditRedemption_userId_idx" ON "CreditRedemption"("userId");
CREATE INDEX "CreditRedemption_periodYear_periodMonth_idx" ON "CreditRedemption"("periodYear", "periodMonth");
ALTER TABLE "CreditRedemption" ADD CONSTRAINT "CreditRedemption_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditRedemption" ADD CONSTRAINT "CreditRedemption_creditAccountId_fkey"
    FOREIGN KEY ("creditAccountId") REFERENCES "CreditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── InstallerCommissionLedger: recurring monthly commission, plan-at-billing ───
CREATE TABLE "InstallerCommissionLedger" (
    "id"                  TEXT NOT NULL,
    "installerId"         TEXT NOT NULL,
    "installerReferralId" TEXT NOT NULL,
    "periodMonth"         INTEGER NOT NULL,
    "periodYear"          INTEGER NOT NULL,
    "planAtBilling"       TEXT NOT NULL,
    "sharePctApplied"     DOUBLE PRECISION NOT NULL,
    "homeownerRevenue"    DOUBLE PRECISION NOT NULL,
    "commissionAmount"    DOUBLE PRECISION NOT NULL,
    "status"              TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt"              TIMESTAMP(3),
    "stripeTransferId"    TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstallerCommissionLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InstallerCommissionLedger_installerReferralId_periodMonth_periodYear_key"
    ON "InstallerCommissionLedger"("installerReferralId", "periodMonth", "periodYear");
CREATE INDEX "InstallerCommissionLedger_installerId_idx" ON "InstallerCommissionLedger"("installerId");
CREATE INDEX "InstallerCommissionLedger_periodYear_periodMonth_idx" ON "InstallerCommissionLedger"("periodYear", "periodMonth");
CREATE INDEX "InstallerCommissionLedger_status_idx" ON "InstallerCommissionLedger"("status");
ALTER TABLE "InstallerCommissionLedger" ADD CONSTRAINT "InstallerCommissionLedger_installerId_fkey"
    FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstallerCommissionLedger" ADD CONSTRAINT "InstallerCommissionLedger_installerReferralId_fkey"
    FOREIGN KEY ("installerReferralId") REFERENCES "InstallerReferral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── HomeownerReferral: add creditsAwarded field ─────────────────────────────────
ALTER TABLE "HomeownerReferral" ADD COLUMN IF NOT EXISTS "creditsAwarded" INTEGER NOT NULL DEFAULT 2500;

-- ── Backfill CreditAccount for every existing user ──────────────────────────────
INSERT INTO "CreditAccount" ("id", "userId", "balance", "lifetimeEarned", "lifetimeRedeemed", "updatedAt")
SELECT
    'ca_' || "id",
    "id",
    0, 0, 0,
    NOW()
FROM "User"
WHERE NOT EXISTS (SELECT 1 FROM "CreditAccount" WHERE "CreditAccount"."userId" = "User"."id")
ON CONFLICT DO NOTHING;
