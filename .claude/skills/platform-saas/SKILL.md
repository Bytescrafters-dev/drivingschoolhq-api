---
name: platform-saas
description: Implement platform-admin SaaS operations for tenants, plans, subscriptions, entitlements, tenant usage, SaaS invoices/payments, due dates, grace periods, suspension/restoration and tenant onboarding. Use for all platform-level features and platform billing workflows.
---

# Platform SaaS

## Mission
Keep platform administration, subscriptions and SaaS billing strictly separate from tenant business operations. `Tenant` is the bridge, not a reason to mix domains.

## Actors and ownership
- `PlatformAdminUser` performs platform operations subject to platform permissions.
- `TenantUser` operates the tenant business subject to tenant access + entitlements + tenant RBAC.
- `Customer` is a driving-school customer, not a platform billing customer.
- Platform billing uses `TenantInvoice`/`TenantPayment`; driving-school billing uses `CustomerInvoice`/`CustomerPayment`.

## Core aggregates
- `Tenant` (+ contacts, provision/activation status).
- `PricePlan` (+ version/limits/features).
- `TenantSubscription` (+ chosen plan, agreed price/billing period, overrides and history).
- `TenantInvoice` (+ items, due/grace dates, status).
- `TenantPayment` (+ amount/reference/recording admin, allocation/reversal as needed).
- `TenantAccess` / `TenantSuspension` (+ effective status and independent manual blocks).

## Tenant onboarding
A platform admin creates tenant and selects plan/billing terms. Persist tenant, subscription, contacts and initial access/billing state atomically where possible. Provision first tenant owner/invitation post-commit, with retry/idempotency. Do not make provisioning depend on a non-transactional email send.

## Entitlements
Plan limits are quantities (e.g., staff, branches, vehicles); features are boolean/capability entitlements (e.g., advanced reports). Resolve effective limits from plan + subscription overrides, never `if(plan.name === 'PRO')` in business modules. Enforce in backend; guard against concurrent creation races.

## Invoices and payments
- Invoice status and outstanding balance follow recorded allocations/payments, not a bare checkbox.
- Admin action **Mark as Paid** must create an auditable payment entry; do not only set invoice status.
- Snapshot financial terms onto the subscription and each issued invoice.
- Avoid double invoices per subscription period; preserve payment and invoice history.
- Protect historical/financial records with correction/void/reversal flows, not destructive overwrites.

## Grace and access
```text
ISSUED → DUE → OVERDUE within grace → grace expired/blocked
                                    ↘ payment → reevaluate all blocks
```
Effective access is determined using **all** unpaid blocking invoices plus any manual/other suspensions. Paying one invoice must not restore a tenant while another blocking invoice or manual suspension remains. Suspended tenant users may log in to restricted billing/support routes according to policy; they must not gain normal operational access.

## Scheduled work
Recurring invoice generation, due-date transitions, suspension reevaluation and reminders must be idempotent, timezone-aware, retry-safe, and persist auditable transitions. Job processors should invoke platform services instead of reimplementing logic.

## Read details when needed
- [entities.md](entities.md) — entity boundaries, relationships, fields.
- [billing-and-access.md](billing-and-access.md) — invoice lifecycle, grace calculation, restore rules.
- [entitlements.md](entitlements.md) — quota/feature enforcement and downgrades.
- [onboarding-and-jobs.md](onboarding-and-jobs.md) — provisioning, cron and idempotency.
- [examples.md](examples.md) — examples and acceptance scenarios.

## Completion gate
- [ ] Correct platform actor/permission.
- [ ] Business and SaaS billing records remain distinct.
- [ ] Financial history preserved and atomic where necessary.
- [ ] Effective access recomputed from all blockers.
- [ ] Entitlements enforced under concurrent requests.
- [ ] No billing rules scattered across tenant operational modules.
- [ ] Negative/temporal tests and audit records present.
