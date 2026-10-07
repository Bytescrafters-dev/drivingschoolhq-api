---
name: multi-tenancy-security
description: Enforce platform/tenant actor separation, trusted tenant and branch scope, resource ownership, tenant-safe Prisma access, RBAC, tenant access suspension, plan entitlements and sensitive document security. Use whenever authorization or tenant data is involved.
---

# Multi-Tenancy Security

## Prime invariant
**A tenant cannot read, mutate, export, attach or infer another tenant's data, even when it knows every identifier.** Applies to counts, aggregates, bulk operations, background jobs and document access.

## Identity boundaries
```text
PlatformAdminUser  → administers SaaS
TenantUser         → operates one driving school under trusted tenant context
Customer           → person receiving services; not inherently a login identity
```
Platform-admin permissions never come from tenant RBAC. Tenant users never gain cross-tenant access just because they are an OWNER or ADMIN in their school.

## Authorization decision
For tenant operations, evaluate as relevant:
1. Authenticated actor and trusted tenant context.
2. Active tenant access (including grace/suspension exceptions).
3. Feature/usage entitlement if action consumes a plan-limited capability.
4. Tenant RBAC permission.
5. Record ownership and nested relationship scope.
6. Domain eligibility/state rules.

For platform operations: platform authentication → platform role/permission → platform business rules. Never treat `tenantId` in an HTTP body as authority.

## Repository safety
- Require `tenantId`/trusted scope in tenant-owned repository interfaces.
- Validate parent-child and cross-resource associations belong to one tenant.
- Filters apply to reads, updates, deletes, counts, lists, reports and exports.
- A UUID, URL parameter, customerId or branchId is not proof of access.
- System jobs must load actual tenant-owned records and validate scope; a queue payload is not a credential.

## Branch scope
`branchId` is narrower than `tenantId`. Validate that any requested branch belongs to the tenant and the actor can operate on it. Do not permit a user scoped to Branch A to act on Branch B solely because both belong to the same tenant.

## Suspensions
Keep `TenantUser.status` separate from `TenantAccess.status`. A tenant suspended for overdue SaaS invoices typically retains restricted billing/support access; do not disable every user's login or delete data. Billing access and manual suspensions are separate reasons.

## Sensitive data
- Minimize medical details; only required certification/fitness and workflow metadata.
- Restrict NIC/passport/birth certificate copies; use authorized access or expiring signed URLs.
- Avoid PII in logs, queues, webhook payloads and error messages.
- Separate public platform data from private tenant datasets.

## Tests required when relevant
- Tenant A accesses its own record; fails for Tenant B ID.
- Cross-tenant relation attachment is denied.
- Branch-scoped staff cannot access other branch records when policy forbids it.
- Suspended tenant blocked from operations; permitted limited routes remain usable.
- Authorized tenant user still cannot exceed entitlement.
- Platform role cannot be spoofed by tenant role.

## Detailed references
- [authorization-model.md](authorization-model.md) — actor matrix and policy order.
- [tenant-scoping.md](tenant-scoping.md) — query/bulk/branch/document edge cases.
- [examples.md](examples.md) — checks and negative test scenarios.

## Review gate
If any scoped resource is fetched by global ID without a verified ownership constraint or the code trusts a client tenant ID, treat it as a blocking security defect.
