-- GridGuide Careers — Job Application tracking
-- Migration: 20260709_job_applications

CREATE TABLE IF NOT EXISTS "JobApplication" (
  "id"          TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "role"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "phone"       TEXT,
  "linkedin"    TEXT,
  "resumeUrl"   TEXT,
  "coverLetter" TEXT,
  "source"      TEXT,
  "status"      TEXT NOT NULL DEFAULT 'NEW',
  "notes"       TEXT,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "JobApplication_status_idx"    ON "JobApplication"("status");
CREATE INDEX IF NOT EXISTS "JobApplication_role_idx"      ON "JobApplication"("role");
CREATE INDEX IF NOT EXISTS "JobApplication_createdAt_idx" ON "JobApplication"("createdAt" DESC);
