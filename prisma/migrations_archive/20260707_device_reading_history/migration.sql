-- Real device telemetry history — one row per successful sync. Not
-- backfilled: dashboards must handle an empty/sparse history gracefully
-- rather than assume data exists back to a device's connection date.

CREATE TABLE IF NOT EXISTS "DeviceReading" (
  "id"         TEXT NOT NULL,
  "deviceId"   TEXT NOT NULL,
  "reading"    JSONB NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceReading_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "DeviceReading" ADD CONSTRAINT "DeviceReading_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "DeviceReading_deviceId_recordedAt_idx" ON "DeviceReading"("deviceId", "recordedAt");
