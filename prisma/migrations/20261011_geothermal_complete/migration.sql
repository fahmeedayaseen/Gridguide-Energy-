-- Geothermal / Energy & Water module completion (Oct 2026)

-- Measurements become nullable: NULL = not reported ("No data"), never zero.
-- Existing rows keep their stored values. Readings entered before this change
-- saved blank form fields as 0; those can't be told apart from real zeros
-- automatically, so they're left as-is (edit or delete them in the UI if needed).
ALTER TABLE "EnterpriseSustainabilityReading"
    ALTER COLUMN "facilityEnergyKwh" DROP NOT NULL,
    ALTER COLUMN "facilityEnergyKwh" DROP DEFAULT,
    ALTER COLUMN "itEnergyKwh" DROP NOT NULL,
    ALTER COLUMN "itEnergyKwh" DROP DEFAULT,
    ALTER COLUMN "geothermalDeliveredKwh" DROP NOT NULL,
    ALTER COLUMN "geothermalDeliveredKwh" DROP DEFAULT,
    ALTER COLUMN "gridEnergyKwh" DROP NOT NULL,
    ALTER COLUMN "gridEnergyKwh" DROP DEFAULT,
    ALTER COLUMN "coolingEnergyKwh" DROP NOT NULL,
    ALTER COLUMN "coolingEnergyKwh" DROP DEFAULT,
    ALTER COLUMN "waterWithdrawnGallons" DROP NOT NULL,
    ALTER COLUMN "waterWithdrawnGallons" DROP DEFAULT,
    ALTER COLUMN "waterConsumedGallons" DROP NOT NULL,
    ALTER COLUMN "waterConsumedGallons" DROP DEFAULT,
    ALTER COLUMN "baselineWaterConsumedGallons" DROP NOT NULL,
    ALTER COLUMN "baselineWaterConsumedGallons" DROP DEFAULT,
    ALTER COLUMN "waterRecycledGallons" DROP NOT NULL,
    ALTER COLUMN "waterRecycledGallons" DROP DEFAULT,
    ALTER COLUMN "carbonAvoidedKg" DROP NOT NULL,
    ALTER COLUMN "carbonAvoidedKg" DROP DEFAULT,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- API-key lookup by hash on every integration request.
CREATE INDEX "EnterpriseApiKey_keyHash_idx" ON "EnterpriseApiKey"("keyHash");
