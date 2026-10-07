# Platform domain entities and relationships

```text
PlatformAdminUser ── creates/manages ── Tenant
PricePlan 1 ── N TenantSubscription N ── 1 Tenant
PricePlan 1 ── N PlanLimit / PlanFeature
TenantSubscription 1 ── N TenantInvoice 1 ── N TenantInvoiceItem
TenantInvoice N ── N TenantPayment (via allocations when needed)
Tenant 1 ── N TenantSuspension
Tenant 1 ── 1 Effective TenantAccess (projection/persisted state)
TenantSubscription 1 ── N TenantLimitOverride (or versioned effective terms)
```

## Entities and important fields

| Entity | Responsibilities |
| --- | --- |
| PlatformAdminUser | identity/status; separate platform roles/permissions |
| Tenant | legal/display name, code, contacts, lifecycle, provisioned/active timestamps |
| TenantContact | owner, primary, finance, technical contact(s) |
| PricePlan | catalogue code/name, active, pricing version, currency, billing period |
| PlanLimit | metric key and max value; unlimited as an explicit policy, not magic `0` |
| PlanFeature | feature key, enabled/access policy |
| TenantSubscription | tenant/plan relation, effective dates, agreed price, billing cycle, terms and status |
| TenantLimitOverride | negotiated per-subscription cap and dates/reason |
| TenantInvoice | tenant, subscription, billing period, invoice number, issued/due/grace dates, total/balance/status |
| TenantInvoiceItem | frozen description, quantity, price, tax/discount metadata |
| TenantPayment | amount, method, external reference, receivedAt, recordedByAdmin, reversal tracking |
| PaymentAllocation | assigns payments/credits to invoices (if one payment can span invoices) |
| TenantAccess | effective tenant access state, reason(s), last evaluation |
| TenantSuspension | manual/security reason, start/end, admin and notes |
| PlatformAuditLog | who/what/when; append-only financial/admin actions |

## Monetary modelling
Use decimal/numeric or integer minor units consistently; do not use JavaScript floating point for currency calculations. Snapshot currency, tax and agreed price into issued invoice lines. Billing period and due/grace instants should be explicit and immutable once issued except through audited correction.

## Lifecycle separation
`Tenant.status` (business lifecycle), `TenantSubscription.status` (commercial contract), `TenantInvoice.status` (receivable) and `TenantAccess.status` (effective authorization) are different.
