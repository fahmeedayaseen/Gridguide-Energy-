-- Restores NOT NULL DEFAULT 0. Readings stored as NULL ("not measured") become 0 — this re-introduces the 'missing = zero' problem.
UPDATE "EnterpriseSustainabilityReading" SET "facilityEnergyKwh" = COALESCE("facilityEnergyKwh", 0), "itEnergyKwh" = COALESCE("itEnergyKwh", 0), "geothermalDeliveredKwh" = COALESCE("geothermalDeliveredKwh", 0), "gridEnergyKwh" = COALESCE("gridEnergyKwh", 0), "coolingEnergyKwh" = COALESCE("coolingEnergyKwh", 0), "waterWithdrawnGallons" = COALESCE("waterWithdrawnGallons", 0), "waterConsumedGallons" = COALESCE("waterConsumedGallons", 0), "baselineWaterConsumedGallons" = COALESCE("baselineWaterConsumedGallons", 0), "waterRecycledGallons" = COALESCE("waterRecycledGallons", 0), "carbonAvoidedKg" = COALESCE("carbonAvoidedKg", 0);
ALTER TABLE "EnterpriseSustainabilityReading"
    ALTER COLUMN "facilityEnergyKwh" SET DEFAULT 0,
    ALTER COLUMN "facilityEnergyKwh" SET NOT NULL,
    ALTER COLUMN "itEnergyKwh" SET DEFAULT 0,
    ALTER COLUMN "itEnergyKwh" SET NOT NULL,
    ALTER COLUMN "geothermalDeliveredKwh" SET DEFAULT 0,
    ALTER COLUMN "geothermalDeliveredKwh" SET NOT NULL,
    ALTER COLUMN "gridEnergyKwh" SET DEFAULT 0,
    ALTER COLUMN "gridEnergyKwh" SET NOT NULL,
    ALTER COLUMN "coolingEnergyKwh" SET DEFAULT 0,
    ALTER COLUMN "coolingEnergyKwh" SET NOT NULL,
    ALTER COLUMN "waterWithdrawnGallons" SET DEFAULT 0,
    ALTER COLUMN "waterWithdrawnGallons" SET NOT NULL,
    ALTER COLUMN "waterConsumedGallons" SET DEFAULT 0,
    ALTER COLUMN "waterConsumedGallons" SET NOT NULL,
    ALTER COLUMN "baselineWaterConsumedGallons" SET DEFAULT 0,
    ALTER COLUMN "baselineWaterConsumedGallons" SET NOT NULL,
    ALTER COLUMN "waterRecycledGallons" SET DEFAULT 0,
    ALTER COLUMN "waterRecycledGallons" SET NOT NULL,
    ALTER COLUMN "carbonAvoidedKg" SET DEFAULT 0,
    ALTER COLUMN "carbonAvoidedKg" SET NOT NULL,
    DROP COLUMN IF EXISTS "updatedAt";
DROP INDEX IF EXISTS "EnterpriseApiKey_keyHash_idx";
