# Module boundaries — Sri Lankan driving-school SaaS

## Two worlds, one boundary

`Tenant` is the bridge between platform operations and tenant business operations.

```text
PlatformAdminUser → Tenant ← TenantSubscription → PricePlan
                       │
                       ├── TenantUser / Branch / Instructor / Vehicle
                       └── Customer → LicenceApplication → stages / class outcomes
```

Platform billing: SaaS → school: `TenantInvoice`, `TenantPayment`.
Customer billing: school → student: `CustomerInvoice`, `CustomerPayment`.
They are different aggregates with different auth and reporting policies.

## Ownership table

| Domain | Owns | Should not own |
| --- | --- | --- |
| Platform identity | PlatformAdminUser, permissions | Tenant RBAC |
| Tenant lifecycle | Tenant, access/suspension | Customer applications |
| Plans/subscriptions | PricePlan, PlanLimit, PlanFeature, TenantSubscription | Business staff records |
| Platform billing | TenantInvoice, TenantPayment | CustomerInvoice |
| Tenant identity | TenantUser, role, permission | PlatformAdminUser |
| Organisation | Branch, Instructor, Vehicle | SaaS subscription |
| Customers | Customer, reusable identity | Medical/test status |
| Licence applications | Application, application class, snapshot, lifecycle | Subscription/payment gateway |
| Examinations | Written/practical attempts and outcomes | Customer identity master |
| Training | Plan, sessions, progress | Platform entitlements |
| Licensing | DrivingLicence, LicenceClass, LicenceIssuance | Platform invoices |
| Customer billing | Packages, student invoices, receipts | SaaS invoices |

## Domain service rules
- An application service that needs plan limits calls a public entitlement API; it does not inspect `PricePlan` tables.
- A billing service that must suspend tenant access uses a public tenant-access service, not writes from unrelated modules.
- A licence service may access customer identity using a Customer module public service/read model; it does not call `CustomerRepository` directly from across a boundary.
- Keep public interfaces small; avoid exporting an entire module's internals.

## Allowed infrastructure
Nest modules and injectable providers, Prisma-backed repositories, scheduled jobs and workers if needed. Not microservices by default.

## When to split a module
Split for distinct aggregates and responsibilities with different invariants, not for a fixed line count. Do not create empty modules only because a conceptual map contains them.
