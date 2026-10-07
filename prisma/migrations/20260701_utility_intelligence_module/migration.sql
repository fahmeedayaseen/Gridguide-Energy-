-- Utility Intelligence Module
-- Migration: 20260701_utility_intelligence_module
--
-- Turns UtilityTerritory into the real "Utilities master table" the platform
-- has needed: connection-method support flags (Green Button / Arcadia /
-- direct API / manual), program eligibility flags, and four new related
-- tables (programs, incentives, rate plans, connection events) so this data
-- is admin-manageable and queryable instead of hardcoded in
-- lib/geo-intelligence.js. See lib/utility-routing.js for the routing logic
-- this enables and app/api/admin/utilities/* for management.

-- ── New enum types ───────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "UtilityProgramCategory" AS ENUM ('DEMAND_RESPONSE','VPP','SOLAR','BATTERY','EV','ENERGY_EFFICIENCY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "UtilityIncentiveCategory" AS ENUM ('FEDERAL_TAX_CREDIT','STATE_TAX_CREDIT','STATE_REBATE','UTILITY_REBATE','NET_METERING','PROPERTY_TAX','SALES_TAX','EV_REBATE','RENEWABLE_CREDIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Extend UtilityTerritory into the master Utilities table ────────────────
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "iso"                       TEXT;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "website"                   TEXT;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "customerPortalUrl"         TEXT;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "phone"                     TEXT;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "supportsGreenButton"       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "supportsArcadia"           BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "supportsDirectApi"         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "supportsManualUpload"      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "preferredConnectionMethod" "UtilityConnectionType";
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "greenButtonAuthUrl"        TEXT;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "arcadiaUtilityId"          TEXT;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "directApiProvider"         TEXT;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "directApiBaseUrl"          TEXT;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "vppEligible"               BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "netMeteringAvailable"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "touRatesAvailable"         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "demandResponseAvailable"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "isActive"                  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "notes"                     TEXT;
ALTER TABLE "UtilityTerritory" ADD COLUMN IF NOT EXISTS "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "UtilityTerritory_isActive_idx" ON "UtilityTerritory"("isActive");

-- ── UtilityProgram ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "UtilityProgram" (
  "id"          TEXT NOT NULL,
  "utilityId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "category"    "UtilityProgramCategory" NOT NULL,
  "description" TEXT,
  "url"         TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UtilityProgram_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "UtilityProgram" ADD CONSTRAINT "UtilityProgram_utilityId_fkey"
    FOREIGN KEY ("utilityId") REFERENCES "UtilityTerritory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "UtilityProgram_utilityId_idx" ON "UtilityProgram"("utilityId");
CREATE INDEX IF NOT EXISTS "UtilityProgram_category_idx" ON "UtilityProgram"("category");

-- ── UtilityIncentive ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "UtilityIncentive" (
  "id"                   TEXT NOT NULL,
  "utilityId"            TEXT,
  "state"                CHAR(2) NOT NULL,
  "name"                 TEXT NOT NULL,
  "category"             "UtilityIncentiveCategory" NOT NULL,
  "value"                TEXT NOT NULL,
  "estimatedDollarValue" DOUBLE PRECISION,
  "expiresOn"            TIMESTAMP(3),
  "stackable"            BOOLEAN NOT NULL DEFAULT true,
  "isActive"             BOOLEAN NOT NULL DEFAULT true,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UtilityIncentive_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "UtilityIncentive" ADD CONSTRAINT "UtilityIncentive_utilityId_fkey"
    FOREIGN KEY ("utilityId") REFERENCES "UtilityTerritory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "UtilityIncentive_utilityId_idx" ON "UtilityIncentive"("utilityId");
CREATE INDEX IF NOT EXISTS "UtilityIncentive_state_idx" ON "UtilityIncentive"("state");
CREATE INDEX IF NOT EXISTS "UtilityIncentive_category_idx" ON "UtilityIncentive"("category");

-- ── UtilityRatePlan ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "UtilityRatePlan" (
  "id"          TEXT NOT NULL,
  "utilityId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "isTou"       BOOLEAN NOT NULL DEFAULT false,
  "peakRate"    DOUBLE PRECISION,
  "offPeakRate" DOUBLE PRECISION,
  "isEvRate"    BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UtilityRatePlan_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "UtilityRatePlan" ADD CONSTRAINT "UtilityRatePlan_utilityId_fkey"
    FOREIGN KEY ("utilityId") REFERENCES "UtilityTerritory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "UtilityRatePlan_utilityId_idx" ON "UtilityRatePlan"("utilityId");

-- ── UtilityConnectionEvent (Phase 3: monitor connection success/errors) ───────
CREATE TABLE IF NOT EXISTS "UtilityConnectionEvent" (
  "id"           TEXT NOT NULL,
  "utilityId"    TEXT,
  "userId"       TEXT NOT NULL,
  "method"       "UtilityConnectionType" NOT NULL,
  "success"      BOOLEAN NOT NULL,
  "errorMessage" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UtilityConnectionEvent_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "UtilityConnectionEvent" ADD CONSTRAINT "UtilityConnectionEvent_utilityId_fkey"
    FOREIGN KEY ("utilityId") REFERENCES "UtilityTerritory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UtilityConnectionEvent" ADD CONSTRAINT "UtilityConnectionEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "UtilityConnectionEvent_utilityId_idx" ON "UtilityConnectionEvent"("utilityId");
CREATE INDEX IF NOT EXISTS "UtilityConnectionEvent_userId_idx" ON "UtilityConnectionEvent"("userId");
CREATE INDEX IF NOT EXISTS "UtilityConnectionEvent_method_idx" ON "UtilityConnectionEvent"("method");
CREATE INDEX IF NOT EXISTS "UtilityConnectionEvent_success_idx" ON "UtilityConnectionEvent"("success");
CREATE INDEX IF NOT EXISTS "UtilityConnectionEvent_createdAt_idx" ON "UtilityConnectionEvent"("createdAt");
