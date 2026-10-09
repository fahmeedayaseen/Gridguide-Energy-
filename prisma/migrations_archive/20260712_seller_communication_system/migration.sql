-- Migration: 20260712_seller_communication_system
-- Phase 1+2: SellerCustomer, SellerCampaign, SellerCampaignRecipient,
-- SellerCampaignConversion, SellerMessageLog, SellerQuote,
-- SellerTeamInvite, SellerCommunicationPolicy

-- Enums
DO $$ BEGIN
  CREATE TYPE "SellerCampaignStatus" AS ENUM ('DRAFT','SCHEDULED','QUEUED','SENDING','SENT','PARTIAL','FAILED','PAUSED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SellerMessageType" AS ENUM (
    'ORDER_CONFIRMATION','PAYMENT_RECEIVED','ORDER_PROCESSING','ORDER_SHIPPED',
    'ORDER_DELIVERED','RETURN_AUTHORIZED','REFUND_ISSUED','REVIEW_REQUEST',
    'PRODUCT_ANNOUNCEMENT','PROMOTIONAL_CAMPAIGN','BACK_IN_STOCK','PRICE_DROP',
    'QUOTE','SUPPORT','TEAM_INVITE'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "SellerCustomer" (
  "id"                TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sellerId"          TEXT NOT NULL REFERENCES "Seller"("id") ON DELETE CASCADE,
  "userId"            TEXT,
  "email"             TEXT NOT NULL,
  "firstName"         TEXT, "lastName" TEXT, "phone" TEXT,
  "address"           TEXT, "city" TEXT, "state" TEXT, "zip" TEXT,
  "marketingOptIn"    BOOLEAN NOT NULL DEFAULT false,
  "marketingOptInAt"  TIMESTAMP(3), "marketingOptOutAt" TIMESTAMP(3),
  "source"            TEXT,
  "totalOrders"       INTEGER NOT NULL DEFAULT 0,
  "lifetimeValue"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastOrderAt"       TIMESTAMP(3), "lastContactAt" TIMESTAMP(3),
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("sellerId","email")
);
CREATE INDEX IF NOT EXISTS "SellerCustomer_sellerId_marketingOptIn_idx" ON "SellerCustomer"("sellerId","marketingOptIn");
CREATE INDEX IF NOT EXISTS "SellerCustomer_sellerId_lastOrderAt_idx"    ON "SellerCustomer"("sellerId","lastOrderAt");

CREATE TABLE IF NOT EXISTS "SellerCampaign" (
  "id"              TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sellerId"        TEXT NOT NULL REFERENCES "Seller"("id") ON DELETE CASCADE,
  "createdByUserId" TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "subject"         TEXT NOT NULL,
  "bodyHtml"        TEXT NOT NULL,
  "bodyText"        TEXT,
  "type"            TEXT NOT NULL DEFAULT 'PROMOTIONAL_CAMPAIGN',
  "status"          "SellerCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "segmentJson"     JSONB,
  "scheduledAt"     TIMESTAMP(3),
  "queuedAt"        TIMESTAMP(3), "startedAt" TIMESTAMP(3),
  "completedAt"     TIMESTAMP(3), "sentAt" TIMESTAMP(3), "failedAt" TIMESTAMP(3),
  "recipientCount"  INTEGER NOT NULL DEFAULT 0,
  "sentCount"       INTEGER NOT NULL DEFAULT 0,
  "openedCount"     INTEGER NOT NULL DEFAULT 0,
  "clickedCount"    INTEGER NOT NULL DEFAULT 0,
  "convertedCount"  INTEGER NOT NULL DEFAULT 0,
  "failedCount"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SellerCampaign_sellerId_status_idx"    ON "SellerCampaign"("sellerId","status");
CREATE INDEX IF NOT EXISTS "SellerCampaign_scheduledAt_status_idx" ON "SellerCampaign"("scheduledAt","status");

CREATE TABLE IF NOT EXISTS "SellerCampaignRecipient" (
  "id"             TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "campaignId"     TEXT NOT NULL REFERENCES "SellerCampaign"("id") ON DELETE CASCADE,
  "customerId"     TEXT,
  "email"          TEXT NOT NULL,
  "firstName"      TEXT, "lastName" TEXT,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "queuedAt"       TIMESTAMP(3), "sentAt" TIMESTAMP(3),
  "openedAt"       TIMESTAMP(3), "clickedAt" TIMESTAMP(3),
  "convertedAt"    TIMESTAMP(3), "failedAt" TIMESTAMP(3),
  "sendAttempts"   INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt"  TIMESTAMP(3), "lastSendError" TEXT,
  "providerId"     TEXT,
  "unsubscribeKey" TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("campaignId","email")
);
CREATE INDEX IF NOT EXISTS "SellerCampaignRecipient_campaignId_status_idx" ON "SellerCampaignRecipient"("campaignId","status");
CREATE INDEX IF NOT EXISTS "SellerCampaignRecipient_email_idx"             ON "SellerCampaignRecipient"("email");

CREATE TABLE IF NOT EXISTS "SellerCampaignConversion" (
  "id"           TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "campaignId"   TEXT NOT NULL REFERENCES "SellerCampaign"("id") ON DELETE CASCADE,
  "recipientId"  TEXT NOT NULL,
  "orderId"      TEXT NOT NULL,
  "revenue"      DOUBLE PRECISION NOT NULL,
  "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "method"       TEXT NOT NULL DEFAULT 'LAST_CLICK',
  UNIQUE("campaignId","orderId")
);
CREATE INDEX IF NOT EXISTS "SellerCampaignConversion_campaignId_attributedAt_idx" ON "SellerCampaignConversion"("campaignId","attributedAt");

CREATE TABLE IF NOT EXISTS "SellerMessageLog" (
  "id"              TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sellerId"        TEXT NOT NULL REFERENCES "Seller"("id") ON DELETE CASCADE,
  "customerId"      TEXT,
  "orderId"         TEXT,
  "quoteId"         TEXT,
  "campaignId"      TEXT,
  "type"            "SellerMessageType" NOT NULL,
  "toEmail"         TEXT NOT NULL,
  "subject"         TEXT NOT NULL,
  "providerId"      TEXT,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "sentAt"          TIMESTAMP(3), "openedAt" TIMESTAMP(3),
  "clickedAt"       TIMESTAMP(3), "failedAt" TIMESTAMP(3),
  "errorMessage"    TEXT,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SellerMessageLog_sellerId_toEmail_idx" ON "SellerMessageLog"("sellerId","toEmail");
CREATE INDEX IF NOT EXISTS "SellerMessageLog_orderId_idx"          ON "SellerMessageLog"("orderId");
CREATE INDEX IF NOT EXISTS "SellerMessageLog_sellerId_type_idx"    ON "SellerMessageLog"("sellerId","type");

CREATE TABLE IF NOT EXISTS "SellerQuote" (
  "id"               TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sellerId"         TEXT NOT NULL REFERENCES "Seller"("id") ON DELETE CASCADE,
  "customerId"       TEXT,
  "createdByUserId"  TEXT NOT NULL,
  "quoteNumber"      TEXT NOT NULL UNIQUE,
  "status"           TEXT NOT NULL DEFAULT 'DRAFT',
  "subtotal"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "discountAmount"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "taxAmount"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "shippingAmount"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expiresAt"        TIMESTAMP(3),
  "sentAt"           TIMESTAMP(3), "viewedAt" TIMESTAMP(3),
  "acceptedAt"       TIMESTAMP(3), "declinedAt" TIMESTAMP(3),
  "convertedOrderId" TEXT,
  "notes"            TEXT,
  "lineItemsJson"    JSONB,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SellerQuote_sellerId_status_idx"    ON "SellerQuote"("sellerId","status");
CREATE INDEX IF NOT EXISTS "SellerQuote_sellerId_createdAt_idx" ON "SellerQuote"("sellerId","createdAt");

CREATE TABLE IF NOT EXISTS "SellerTeamInvite" (
  "id"          TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sellerId"    TEXT NOT NULL REFERENCES "Seller"("id") ON DELETE CASCADE,
  "email"       TEXT NOT NULL,
  "role"        TEXT NOT NULL DEFAULT 'VIEWER',
  "token"       TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "sentAt"      TIMESTAMP(3), "acceptedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("sellerId","email")
);
CREATE INDEX IF NOT EXISTS "SellerTeamInvite_sellerId_status_idx" ON "SellerTeamInvite"("sellerId","status");

CREATE TABLE IF NOT EXISTS "SellerCommunicationPolicy" (
  "id"                        TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
  "campaignsEnabled"          BOOLEAN NOT NULL DEFAULT true,
  "freeMonthlyRecipientLimit" INTEGER NOT NULL DEFAULT 0,
  "proMonthlyRecipientLimit"  INTEGER NOT NULL DEFAULT 5000,
  "enterpriseRecipientLimit"  INTEGER,
  "maxDailyRecipients"        INTEGER NOT NULL DEFAULT 1000,
  "requireVerifiedSender"     BOOLEAN NOT NULL DEFAULT true,
  "reviewFlaggedCampaigns"    BOOLEAN NOT NULL DEFAULT true,
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed default policy
INSERT INTO "SellerCommunicationPolicy" ("id","updatedAt") VALUES ('singleton', CURRENT_TIMESTAMP)
  ON CONFLICT ("id") DO NOTHING;
