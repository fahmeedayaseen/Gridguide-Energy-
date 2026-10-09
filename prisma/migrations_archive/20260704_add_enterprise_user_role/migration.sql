-- Add ENTERPRISE to UserRole. Without this, no user could ever actually
-- have role="ENTERPRISE" — SELLER and INSTALLER are already first-class
-- roles here, this closes the gap for the Enterprise Portal, which was
-- otherwise checking for a role value that could never exist in the DB.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ENTERPRISE';
