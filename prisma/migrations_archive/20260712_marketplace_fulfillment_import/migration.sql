-- Migration: 20260712_marketplace_fulfillment_import
-- Adds: SellerFulfillment, InstallerCustomerInvite, InstallerImportBatch,
--       InstallerCampaign, Order tracking/refund fields, FulfillmentStatus enum

-- FulfillmentStatus enum
DO $$ BEGIN
  CREATE TYPE "FulfillmentStatus" AS ENUM ('PENDING','PROCESSING','SHIPPED','DELIVERED','CANCELLED','RETURNED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- SellerFulfillment
CREATE TABLE IF NOT EXISTS "SellerFulfillment" (
  "id"             TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orderId"        TEXT        NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "sellerId"       TEXT        NOT NULL REFERENCES "Seller"("id") ON DELETE CASCADE,
  "status"         "FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
  "carrier"        TEXT,
  "trackingNumber" TEXT,
  "trackingUrl"    TEXT,
  "shippedAt"      TIMESTAMP(3),
  "deliveredAt"    TIMESTAMP(3),
  "cancelledAt"    TIMESTAMP(3),
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("orderId","sellerId")
);
CREATE INDEX IF NOT EXISTS "SellerFulfillment_sellerId_status_idx" ON "SellerFulfillment"("sellerId","status");
CREATE INDEX IF NOT EXISTS "SellerFulfillment_orderId_idx" ON "SellerFulfillment"("orderId");

-- Order fulfillment/refund fields
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "trackingNumber"     TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "carrier"            TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippedAt"          TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveredAt"        TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelledAt"        TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "refundedAt"         TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "refundAmount"       DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;

-- InstallerImportBatch
CREATE TABLE IF NOT EXISTS "InstallerImportBatch" (
  "id"          TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "installerId" TEXT NOT NULL REFERENCES "Installer"("id") ON DELETE CASCADE,
  "fileName"    TEXT,
  "totalRows"   INTEGER NOT NULL DEFAULT 0,
  "imported"    INTEGER NOT NULL DEFAULT 0,
  "skipped"     INTEGER NOT NULL DEFAULT 0,
  "errors"      INTEGER NOT NULL DEFAULT 0,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "errorLog"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "InstallerImportBatch_installerId_idx" ON "InstallerImportBatch"("installerId");

-- InstallerCampaign
CREATE TABLE IF NOT EXISTS "InstallerCampaign" (
  "id"          TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "installerId" TEXT NOT NULL REFERENCES "Installer"("id") ON DELETE CASCADE,
  "name"        TEXT NOT NULL,
  "subject"     TEXT NOT NULL,
  "body"        TEXT,
  "status"      TEXT NOT NULL DEFAULT 'DRAFT',
  "sentCount"   INTEGER NOT NULL DEFAULT 0,
  "openCount"   INTEGER NOT NULL DEFAULT 0,
  "clickCount"  INTEGER NOT NULL DEFAULT 0,
  "signupCount" INTEGER NOT NULL DEFAULT 0,
  "scheduledAt" TIMESTAMP(3),
  "sentAt"      TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "InstallerCampaign_installerId_idx" ON "InstallerCampaign"("installerId");

-- InstallerCustomerInvite
CREATE TABLE IF NOT EXISTS "InstallerCustomerInvite" (
  "id"              TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "installerId"     TEXT NOT NULL REFERENCES "Installer"("id") ON DELETE CASCADE,
  "email"           TEXT NOT NULL,
  "firstName"       TEXT,
  "lastName"        TEXT,
  "phone"           TEXT,
  "address"         TEXT,
  "city"            TEXT,
  "state"           TEXT,
  "zip"             TEXT,
  "systemType"      TEXT,
  "batterySystem"   BOOLEAN NOT NULL DEFAULT false,
  "utility"         TEXT,
  "installDate"     TIMESTAMP(3),
  "inviteToken"     TEXT NOT NULL UNIQUE,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "sentAt"          TIMESTAMP(3),
  "openedAt"        TIMESTAMP(3),
  "clickedAt"       TIMESTAMP(3),
  "acceptedAt"      TIMESTAMP(3),
  "signedUpAt"      TIMESTAMP(3),
  "subscribedAt"    TIMESTAMP(3),
  "convertedUserId" TEXT,
  "importBatchId"   TEXT REFERENCES "InstallerImportBatch"("id"),
  "campaignId"      TEXT REFERENCES "InstallerCampaign"("id"),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "InstallerCustomerInvite_installerId_idx" ON "InstallerCustomerInvite"("installerId");
CREATE INDEX IF NOT EXISTS "InstallerCustomerInvite_inviteToken_idx" ON "InstallerCustomerInvite"("inviteToken");
CREATE INDEX IF NOT EXISTS "InstallerCustomerInvite_status_idx"       ON "InstallerCustomerInvite"("status");
