-- Admin-configurable assumption for the installer VPP "projected per event" figure.
ALTER TABLE "PlatformConfig" ADD COLUMN IF NOT EXISTS "vppProjectedPerEventRate" DOUBLE PRECISION NOT NULL DEFAULT 5;
