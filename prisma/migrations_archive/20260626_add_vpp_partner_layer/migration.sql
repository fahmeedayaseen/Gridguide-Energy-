-- GridGuide VPP partner integration layer: Leap / Enel / future partners
-- Production-safe: creates schema only; no fake data.

CREATE TYPE "VppProviderStatus" AS ENUM ('ACTIVE','SANDBOX','PENDING_CREDENTIALS','PAUSED','ERROR');
CREATE TYPE "VppProgramType" AS ENUM ('DEMAND_RESPONSE','BATTERY_DISPATCH','THERMOSTAT_CONTROL','EV_CHARGING_MANAGEMENT','SOLAR_EXPORT');
CREATE TYPE "VppProgramAvailability" AS ENUM ('ACTIVE','WAITLIST','PAUSED','CLOSED');
CREATE TYPE "VppEnrollmentStatus" AS ENUM ('PENDING_CONSENT','PENDING_PROVIDER','ACTIVE','REJECTED','PAUSED','CANCELLED','NEEDS_REAUTH');
CREATE TYPE "VppPartnerEventStatus" AS ENUM ('SCHEDULED','ACTIVE','COMPLETED','CANCELLED','SETTLEMENT_PENDING','SETTLED','FAILED');
CREATE TYPE "VppParticipationStatus" AS ENUM ('INVITED','OPTED_IN','DISPATCHED','COMPLETED','MISSED','OPTED_OUT','FAILED');
CREATE TYPE "VppRevenueStatus" AS ENUM ('CALCULATED','APPROVED','PAYOUT_PENDING','PAID','HELD','FAILED');

CREATE TABLE "vpp_providers" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "status" "VppProviderStatus" NOT NULL DEFAULT 'PENDING_CREDENTIALS',
  "apiBaseUrl" TEXT,
  "webhookSecretRef" TEXT,
  "supportsOAuth" BOOLEAN NOT NULL DEFAULT false,
  "supportsWebhook" BOOLEAN NOT NULL DEFAULT true,
  "contactEmail" TEXT,
  "notes" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "vpp_programs" (
  "id" TEXT PRIMARY KEY,
  "providerId" TEXT NOT NULL REFERENCES "vpp_providers"("id") ON DELETE CASCADE,
  "externalProgramId" TEXT,
  "name" TEXT NOT NULL,
  "market" TEXT,
  "state" TEXT,
  "utility" TEXT,
  "programType" "VppProgramType" NOT NULL DEFAULT 'DEMAND_RESPONSE',
  "deviceTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "VppProgramAvailability" NOT NULL DEFAULT 'ACTIVE',
  "rules" JSONB,
  "estimatedRateKwh" DOUBLE PRECISION,
  "estimatedRateKw" DOUBLE PRECISION,
  "gridguideFeePct" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
  "installerSharePct" DOUBLE PRECISION NOT NULL DEFAULT 0.00,
  "homeownerSharePct" DOUBLE PRECISION NOT NULL DEFAULT 0.90,
  "conflictGroup" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "vpp_programs_providerId_idx" ON "vpp_programs"("providerId");
CREATE INDEX "vpp_programs_state_utility_idx" ON "vpp_programs"("state", "utility");
CREATE INDEX "vpp_programs_market_idx" ON "vpp_programs"("market");

CREATE TABLE "vpp_enrollments" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "providerId" TEXT NOT NULL REFERENCES "vpp_providers"("id") ON DELETE CASCADE,
  "programId" TEXT NOT NULL REFERENCES "vpp_programs"("id") ON DELETE CASCADE,
  "externalEnrollmentId" TEXT,
  "status" "VppEnrollmentStatus" NOT NULL DEFAULT 'PENDING_CONSENT',
  "consentVersion" TEXT,
  "consentAcceptedAt" TIMESTAMP(3),
  "utilityAccountId" TEXT,
  "deviceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "routeReason" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "syncError" TEXT,
  "metadata" JSONB,
  "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("userId", "programId")
);

CREATE INDEX "vpp_enrollments_userId_idx" ON "vpp_enrollments"("userId");
CREATE INDEX "vpp_enrollments_providerId_idx" ON "vpp_enrollments"("providerId");
CREATE INDEX "vpp_enrollments_status_idx" ON "vpp_enrollments"("status");

CREATE TABLE "vpp_events" (
  "id" TEXT PRIMARY KEY,
  "providerId" TEXT NOT NULL REFERENCES "vpp_providers"("id") ON DELETE CASCADE,
  "programId" TEXT REFERENCES "vpp_programs"("id") ON DELETE SET NULL,
  "externalEventId" TEXT,
  "name" TEXT NOT NULL,
  "eventType" "VppProgramType" NOT NULL DEFAULT 'DEMAND_RESPONSE',
  "market" TEXT,
  "utility" TEXT,
  "state" TEXT,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "status" "VppPartnerEventStatus" NOT NULL DEFAULT 'SCHEDULED',
  "targetKw" DOUBLE PRECISION,
  "committedKw" DOUBLE PRECISION,
  "deliveredKwh" DOUBLE PRECISION,
  "grossRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "vpp_events_providerId_idx" ON "vpp_events"("providerId");
CREATE INDEX "vpp_events_programId_idx" ON "vpp_events"("programId");
CREATE INDEX "vpp_events_status_idx" ON "vpp_events"("status");
CREATE INDEX "vpp_events_windowStart_idx" ON "vpp_events"("windowStart");

CREATE TABLE "vpp_event_participation" (
  "id" TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL REFERENCES "vpp_events"("id") ON DELETE CASCADE,
  "enrollmentId" TEXT NOT NULL REFERENCES "vpp_enrollments"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "deviceId" TEXT,
  "status" "VppParticipationStatus" NOT NULL DEFAULT 'INVITED',
  "committedKw" DOUBLE PRECISION,
  "deliveredKwh" DOUBLE PRECISION,
  "baselineKwh" DOUBLE PRECISION,
  "performancePct" DOUBLE PRECISION,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("eventId", "enrollmentId")
);

CREATE INDEX "vpp_event_participation_userId_idx" ON "vpp_event_participation"("userId");
CREATE INDEX "vpp_event_participation_status_idx" ON "vpp_event_participation"("status");

CREATE TABLE "vpp_revenue_splits" (
  "id" TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL REFERENCES "vpp_events"("id") ON DELETE CASCADE,
  "enrollmentId" TEXT NOT NULL REFERENCES "vpp_enrollments"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "installerId" TEXT,
  "grossAmount" DOUBLE PRECISION NOT NULL,
  "homeownerAmount" DOUBLE PRECISION NOT NULL,
  "gridguideAmount" DOUBLE PRECISION NOT NULL,
  "installerAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" "VppRevenueStatus" NOT NULL DEFAULT 'CALCULATED',
  "payoutBatchId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("eventId", "enrollmentId")
);

CREATE INDEX "vpp_revenue_splits_userId_idx" ON "vpp_revenue_splits"("userId");
CREATE INDEX "vpp_revenue_splits_status_idx" ON "vpp_revenue_splits"("status");

CREATE TABLE "vpp_provider_webhooks" (
  "id" TEXT PRIMARY KEY,
  "providerId" TEXT NOT NULL REFERENCES "vpp_providers"("id") ON DELETE CASCADE,
  "eventType" TEXT NOT NULL,
  "externalId" TEXT,
  "payload" JSONB NOT NULL,
  "processed" BOOLEAN NOT NULL DEFAULT false,
  "processError" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "vpp_provider_webhooks_providerId_idx" ON "vpp_provider_webhooks"("providerId");
CREATE INDEX "vpp_provider_webhooks_eventType_idx" ON "vpp_provider_webhooks"("eventType");
CREATE INDEX "vpp_provider_webhooks_processed_idx" ON "vpp_provider_webhooks"("processed");
