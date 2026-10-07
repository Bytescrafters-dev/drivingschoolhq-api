---
name: prisma-repositories
description: Implement Prisma-backed repository interfaces for NestJS, including tenant-scoped queries, schema design, PostgreSQL indexes and constraints, safe transactions, pagination, migrations and persistence tests. Use whenever persistence or Prisma behavior changes.
---

# Prisma Repositories

## Required convention
This project's backend normally follows:
```text
Service → Repository Interface → DI Token → Prisma Repository Implementation → Prisma → PostgreSQL
```
**Do not call Prisma directly from controllers or business services** when the repository abstraction exists. Read `CLAUDE.md` and inspect nearby interfaces, providers and migrations before editing.

## Procedure
1. Identify aggregate ownership and tenant scope.
2. Determine read/write use cases and repository method contracts.
3. Inspect existing Prisma models and query patterns.
4. Define relations, nullability, uniqueness, indexes and on-delete policy.
5. Implement scoped queries, correct includes/selects and mapping.
6. Define an atomic transaction boundary for multi-write invariants.
7. Generate, inspect and test migrations if schema changes.
8. Add repository/integration tests, especially cross-tenant tests.

## Repository API rules
- Prefer `findByIdForTenant(tenantId, id)` and `findBlockingInvoices(tenantId, at)` to Prisma-shaped generic methods.
- Expose only the domain data/use cases needed, not unrestricted `Prisma.*Args` from application services.
- For tenant-owned records, include tenant constraints in the executed query, not only an earlier validation.
- Validate tenant scope of foreign-key relationships on create/update/connect, including indirectly tenant-owned children.
- Scope `count`, `aggregate`, `groupBy`, `updateMany`, `deleteMany`, pagination and exports too.

## Data integrity
- Use composite uniqueness when identity is only unique within tenant or parent.
- Historical attempts, payments, permits and subscriptions must not be rewritten to hide past state.
- Prefer relational tables for stable structured data; use JSON only for genuinely variable metadata.
- Avoid cascades that erase audit, financial, licence or attempt histories.
- Use DB-level correctness for concurrent quota/payment/invoice creation, not just preflight counts.

## Transactions
- Keep a single transaction boundary around one invariant-changing use case.
- Ensure repository calls participate in the same transaction, following the project's established transaction-context abstraction.
- External email, SMS, file upload and HTTP calls should not run inside DB transactions.
- Use idempotency/unique constraints when the same payment, invoice period, attempt or job can be processed twice.

## Prisma migrations
Never reset production/shared databases. Review generated SQL for locks, data loss, validation and backfill needs; Prisma schema alone may not express all PostgreSQL constraints. Any custom SQL constraint must be documented and tested.

## Read when needed
- [query-patterns.md](query-patterns.md) — safe filtering/pagination and relation scoping.
- [transactions.md](transactions.md) — transaction clients, concurrency and idempotency.
- [schema-migrations.md](schema-migrations.md) — modelling and migration review.
- [examples.md](examples.md) — scoped repository implementations.

## Completion checklist
- [ ] Services use repository interfaces/DI.
- [ ] Queries, writes and relations cannot cross tenants.
- [ ] Unique constraints and indexes support business behavior.
- [ ] Transaction and duplicate execution behavior are correct.
- [ ] Migration SQL checked, if changed.
- [ ] Tests exercise actual DB behavior where relevant.
