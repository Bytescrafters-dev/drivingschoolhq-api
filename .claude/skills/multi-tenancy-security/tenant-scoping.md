# Tenant and branch scoping review

## Inputs are references, not authority
Request parameters `tenantId`, `branchId`, `customerId`, `applicationId`, `instructorId` and `vehicleId` never establish access by themselves. Read trusted tenant identity from authenticated context. Validate optional branch role assignments and nested ownership.

## Queries and mutation surfaces
Check all paths, not only list endpoints:
- detail reads and writes
- `count` / aggregate / reporting endpoints
- pagination/export/download endpoints
- connect/disconnect nested relations
- bulk updates and deletes
- notification recipients
- signed document URL generation
- background jobs and import tooling

## Domain example
Scheduling a class-B session with `applicationId`, `instructorId`, `vehicleId`:
- application belongs to tenant
- class belongs to application
- instructor belongs to tenant and is qualified for class
- vehicle belongs to tenant and is suitable
- all three satisfy branch/resource authorization and scheduling constraints

## Information leakage
Use consistent not-found/forbidden behavior based on project policy. Do not disclose that a foreign-tenant ID exists through error wording, timing-sensitive debug output, or counts.

## Data protection
Keep tenant file storage namespaced; ensure signed URLs are generated only after scoped access checks. Retention and deletion policy should account for business and regulatory records.
