-- GridGuide PlatformConfig — Admin-adjustable rates and percentages
-- Migration: 20260626_platform_config

CREATE TABLE "PlatformConfig" (
    "id"                          TEXT NOT NULL DEFAULT 'singleton',
    "installerShareFree"          DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "installerSharePro"           DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "installerShareEnterprise"    DOUBLE PRECISION NOT NULL DEFAULT 0.30,
    "successFeeFree"              DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "successFeePro"               DOUBLE PRECISION NOT NULL DEFAULT 0.07,
    "successFeeEnterprise"        DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "membershipFeeFree"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "membershipFeePro"            DOUBLE PRECISION NOT NULL DEFAULT 99,
    "membershipFeeEnterprise"     DOUBLE PRECISION NOT NULL DEFAULT 499,
    "homeownerReferralSignupPts"  INTEGER NOT NULL DEFAULT 500,
    "homeownerReferralSubPts"     INTEGER NOT NULL DEFAULT 1000,
    "homeownerReferralCredit"     DOUBLE PRECISION NOT NULL DEFAULT 5.00,
    "vppGridguideFee"             DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "vppHomeownerShare"           DOUBLE PRECISION NOT NULL DEFAULT 0.90,
    "vppInstallerBonus"           DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "sellerCommissionFree"        DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "sellerCommissionPro"         DOUBLE PRECISION NOT NULL DEFAULT 0.08,
    "marketplaceFee"              DOUBLE PRECISION NOT NULL DEFAULT 0.03,
    "withdrawalFee"               DOUBLE PRECISION NOT NULL DEFAULT 0.00,
    "updatedAt"                   TIMESTAMP(3) NOT NULL,
    "updatedBy"                   TEXT,
    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row with defaults
INSERT INTO "PlatformConfig" ("id", "updatedAt") VALUES ('singleton', NOW())
ON CONFLICT ("id") DO NOTHING;
