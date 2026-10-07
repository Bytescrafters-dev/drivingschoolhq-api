# Tenant onboarding, invoicing jobs and provisioning

## Admin onboarding workflow
1. Platform admin authenticated and authorized to create tenant.
2. Validate tenant identity/contact, plan and billing terms.
3. Create tenant, subscription and access state in a single appropriate DB transaction.
4. Create first invoice based on selected billing policy (upfront, trial or postpaid), if applicable.
5. Commit.
6. Provision tenant owner/invitation and notifications with retry/idempotency.
7. Audit creation, selected plan and any overrides.

Do not hold a DB transaction open across email, external payment or other provider calls.

## Recurring jobs
- Generate invoices for eligible billing periods.
- Advance overdue state after due date.
- Reevaluate effective access when grace deadlines pass, payments arrive or manual blocks change.
- Send due/grace/suspension reminders.
- Reconcile previously failed post-commit messages/invitations.

## Worker design
```text
cron/queue trigger → load current state → domain service → atomic transition → outbox/notification
```
Use tenant/subscription/invoice IDs rather than sensitive serialized data. A worker rerun must not produce duplicate invoices or reminders.

## Idempotency and concurrency
- Unique `(subscriptionId, billingPeriodStart, billingPeriodEnd, invoiceKind)` or equivalent invariant for generated invoices.
- Repeatable scheduler query based on persistent due state (do not assume previous run succeeded).
- Atomic claiming/locking or constraint to protect overlapping schedules.
- Retry transient errors with bounded backoff; do not retry permanent domain validation endlessly.
- Prevent 'enqueue before commit then rollback' inconsistency; adopt durable outbox if required.

## Date/time
Store instants consistently (commonly UTC), but resolve billing boundaries, due dates and grace windows using the tenant's explicitly configured billing timezone. For Sri Lankan schools, `Asia/Colombo` may be the configured default; don't implicitly use server local timezone.

## Deactivation
Suspension stops business access, not data retention. Cancellation, deletion, and retention should be separate audited workflows.
