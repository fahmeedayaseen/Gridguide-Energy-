-- Rename the homeowner Plan enum values to remove ambiguity with
-- EnterpriseOrg's own "ENTERPRISE" tier (an unrelated concept that
-- happened to share the same string). See
-- ENTERPRISE_PHASES_2_7_DESIGN_AND_PLAN.md section 1.1 for the full
-- reasoning. This only affects User.plan and the deprecated,
-- zero-consumer Organization.plan - verified InstallerPlan and
-- SellerPlan are separate enums, unaffected by this change.
ALTER TYPE "Plan" RENAME VALUE 'FREE' TO 'HOMEOWNER_FREE';
ALTER TYPE "Plan" RENAME VALUE 'PRO' TO 'HOMEOWNER_PLUS';
ALTER TYPE "Plan" RENAME VALUE 'ENTERPRISE' TO 'HOMEOWNER_PREMIUM';
