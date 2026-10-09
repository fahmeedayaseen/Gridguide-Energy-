-- GridGuide — One-time reward idempotency guard
-- Migration: 20260709_reward_grant_idempotency
--
-- RewardGrant is the hard stop for every one-time credit reward.
-- Before awarding credits, code inserts a row with a unique (userId, rewardKey).
-- If the row already exists the INSERT fails (unique constraint) and the credits
-- are NOT awarded — regardless of disconnects, reconnects, or duplicate requests.
--
-- rewardKey examples:
--   device_connect:{deviceId}             — 250 credits, once per device DB id
--   referral_subscribed:{referralId}      — 2,500 credits, once per referral
--   home_profile_complete:{userId}        — 300 credits, once per account
--   rebate_submit:{rebateId}              — 100 credits, once per rebate
--   installer_review:{installerId}:{userId} — 75 credits, once per installer

CREATE TABLE IF NOT EXISTS "RewardGrant" (
  "id"        TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "rewardKey" TEXT NOT NULL,
  "credits"   INTEGER NOT NULL,
  "reason"    TEXT NOT NULL,
  "metadata"  JSONB,
  "grantedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "RewardGrant_userId_rewardKey_key" UNIQUE ("userId", "rewardKey")
);

CREATE INDEX IF NOT EXISTS "RewardGrant_userId_idx"    ON "RewardGrant"("userId");
CREATE INDEX IF NOT EXISTS "RewardGrant_rewardKey_idx" ON "RewardGrant"("rewardKey");
