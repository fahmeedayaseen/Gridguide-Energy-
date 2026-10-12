-- Admin-configurable rewards program: tiers, point rules, redemption
-- catalog, and achievement badges - replacing hardcoded/duplicated arrays.

CREATE TABLE IF NOT EXISTS "RewardTier" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "minPoints" INTEGER NOT NULL,
  "discountPct" DOUBLE PRECISION NOT NULL DEFAULT 0, "perks" TEXT, "color" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RewardTier_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RewardTier_name_key" ON "RewardTier"("name");
CREATE INDEX IF NOT EXISTS "RewardTier_minPoints_idx" ON "RewardTier"("minPoints");

CREATE TABLE IF NOT EXISTS "PointRule" (
  "id" TEXT NOT NULL, "actionCode" TEXT NOT NULL, "label" TEXT NOT NULL,
  "points" INTEGER NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PointRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PointRule_actionCode_key" ON "PointRule"("actionCode");

CREATE TABLE IF NOT EXISTS "RewardCatalogItem" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
  "pointsCost" INTEGER NOT NULL, "dollarValue" DOUBLE PRECISION NOT NULL,
  "fulfillmentType" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RewardCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Badge" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT NOT NULL,
  "iconName" TEXT NOT NULL DEFAULT 'award', "triggerType" TEXT NOT NULL,
  "triggerActionCode" TEXT, "triggerThreshold" INTEGER,
  "bonusPoints" INTEGER NOT NULL DEFAULT 0, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserBadge" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "badgeId" TEXT NOT NULL,
  "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "awardedByUserId" TEXT,
  CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeId_fkey"
    FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "UserBadge_userId_badgeId_key" ON "UserBadge"("userId", "badgeId");
CREATE INDEX IF NOT EXISTS "UserBadge_userId_idx" ON "UserBadge"("userId");

-- Seed the exact current values so behavior is identical on migration day -
-- an admin can change them afterward, but nothing shifts silently at deploy time.
INSERT INTO "RewardTier" ("id","name","minPoints","discountPct","sortOrder","updatedAt") VALUES
  ('tier_bronze',   'Bronze',   0,    0.00, 0, CURRENT_TIMESTAMP),
  ('tier_silver',   'Silver',   1000, 0.05, 1, CURRENT_TIMESTAMP),
  ('tier_gold',     'Gold',     3000, 0.10, 2, CURRENT_TIMESTAMP),
  ('tier_platinum', 'Platinum', 7500, 0.15, 3, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "PointRule" ("id","actionCode","label","points","updatedAt") VALUES
  ('rule_rebate_applied', 'REBATE_APPLIED', 'Homeowner applies a rebate', 50, CURRENT_TIMESTAMP)
ON CONFLICT ("actionCode") DO NOTHING;
