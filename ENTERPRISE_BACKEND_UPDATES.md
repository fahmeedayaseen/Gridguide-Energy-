# GridGuide Backend — Enterprise, Utility, VPP, Revenue Updates

Backend-only additions applied to the clean membership backend package.

## Added database models

### Enterprise organizations and teams
- `Organization`
- `OrganizationMember`
- `OrganizationType`
- `OrganizationStatus`
- `OrgMemberRole`
- `MemberStatus`

Supports enterprise accounts, owner/admin/member roles, team seats, API enablement, white-label enablement, and organization-level property limits.

### Multi-property management
- `Property`
- `PropertyType`

Supports consumer and enterprise multi-property tracking with address, location, utility, square footage, and metadata fields.

### Utility integrations
- `UtilityAccount`
- `UtilityConnectionType`
- `UtilityConnectionStatus`

Supports manual utility connections, Green Button, DER API, utility API, and CSV-upload-based utility accounts.

### VPP operations
- `VppProgram`
- `VppOperation`
- `ProgramStatus`
- `VppOperationType`
- `VppOperationStatus`

Supports demand-response events, battery dispatch, EV charging shifts, thermostat pre-cooling, load reduction, revenue estimates, actual revenue, and GridGuide fee calculation.

### Revenue and payout workflows
- `RevenueTransaction`
- `RevenueSource`
- `RevenueStatus`
- `PayoutBatch`
- `PayoutBatchType`

Supports platform revenue tracking for memberships, marketplace commissions, seller commissions, installer success fees, VPP events, enterprise contracts, rebate processing, and payout batch creation.

## Added backend helpers

### `lib/enterprise.js`
- Enterprise access checks
- Organization role permissions
- Property limit checks
- Organization slug creation
- GridGuide fee calculation
- Enterprise organization summary formatting

## Added API routes

### Enterprise organization APIs
- `GET /api/enterprise/organizations`
- `POST /api/enterprise/organizations`
- `GET /api/enterprise/organizations/[id]/members`
- `POST /api/enterprise/organizations/[id]/members`

### Property APIs
- `GET /api/properties`
- `POST /api/properties`

### Utility account APIs
- `GET /api/utility/accounts`
- `POST /api/utility/accounts`

### VPP operation APIs
- `GET /api/vpp/operations`
- `POST /api/vpp/operations` admin only

### Revenue APIs
- `GET /api/revenue/transactions` admin only
- `GET /api/revenue/payout-batches` admin only
- `POST /api/revenue/payout-batches` admin only

## Validation performed

- JavaScript syntax check passed for all backend JS files.
- Prisma model/enum duplicate check passed.
- Prisma CLI validation was skipped because `node_modules` was not installed in the uploaded zip.

## Frontend/portal note

No frontend UI was added to this backend package. The frontend and portals should now be updated separately to consume these APIs.
