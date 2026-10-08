-- Installer → Settings notification toggles (new leads, job reminders, reviews, payouts).
-- Nullable: null means "never saved", and the UI falls back to its defaults.
ALTER TABLE "Installer" ADD COLUMN IF NOT EXISTS "notificationPrefs" JSONB;
