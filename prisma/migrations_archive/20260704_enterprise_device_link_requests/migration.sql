-- Consent gate for linking a homeowner's device to an Enterprise property.
-- An enterprise admin can only create a PENDING request naming the
-- homeowner by email; Device.enterprisePropertyId is only ever actually
-- set once the homeowner approves (or a platform admin overrides).

CREATE TABLE IF NOT EXISTS "EnterpriseDeviceLinkRequest" (
  "id"                TEXT NOT NULL,
  "orgId"             TEXT NOT NULL,
  "propertyId"        TEXT NOT NULL,
  "homeownerEmail"    TEXT NOT NULL,
  "homeownerUserId"   TEXT,
  "deviceId"          TEXT,
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  "requestedByUserId" TEXT NOT NULL,
  "resolvedByUserId"  TEXT,
  "resolvedByRole"    TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"        TIMESTAMP(3),
  CONSTRAINT "EnterpriseDeviceLinkRequest_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "EnterpriseDeviceLinkRequest" ADD CONSTRAINT "EnterpriseDeviceLinkRequest_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "EnterpriseDeviceLinkRequest" ADD CONSTRAINT "EnterpriseDeviceLinkRequest_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "EnterpriseProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "EnterpriseDeviceLinkRequest_orgId_idx" ON "EnterpriseDeviceLinkRequest"("orgId");
CREATE INDEX IF NOT EXISTS "EnterpriseDeviceLinkRequest_homeownerEmail_idx" ON "EnterpriseDeviceLinkRequest"("homeownerEmail");
CREATE INDEX IF NOT EXISTS "EnterpriseDeviceLinkRequest_homeownerUserId_idx" ON "EnterpriseDeviceLinkRequest"("homeownerUserId");
CREATE INDEX IF NOT EXISTS "EnterpriseDeviceLinkRequest_status_idx" ON "EnterpriseDeviceLinkRequest"("status");
