-- GridGuide Installer Pro — 14-day free trial
-- Migration: 20260709_installer_pro_trial
--
-- Adds trialEndsAt to track when an installer's Pro free trial expires.
-- NULL for Free plan (no trial) and Enterprise (uses a sales-assisted
-- 30-day guided pilot, not an automatic self-serve trial).
-- Stripe handles the actual billing pause via trial_period_days: 14.

ALTER TABLE "Installer" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP;
