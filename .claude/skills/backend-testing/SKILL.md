---
name: backend-testing
description: Design and implement focused unit, integration, repository and NestJS e2e tests for domain workflows, tenant boundaries, platform billing, Prisma transactions, retries and regressions. Use whenever creating or updating automated tests.
---

# Backend Testing

## Goal
Prove important behaviors, invariants and security boundaries. Do not write tests only to increase coverage. Read `CLAUDE.md`, inspect existing test conventions, and use the project's installed test runner/database tooling.

## Write tests alongside implementation
1. Extract happy path, validation, authorization, cross-tenant and invalid-transition scenarios from the requirement.
2. Choose the lowest test layer that proves each behavior.
3. For bugs: reproduce with a regression test first when practical.
4. Implement targeted tests using established fixtures/builders and service/repository DI tokens.
5. Run targeted tests, then hand off to `backend-verification` for final checks.

## Unit tests
Test pure eligibility, subscription access evaluation, invoice calculations, application transitions, resource availability, object mapping (where significant). Mock **interfaces**/ports at the service boundary, not Prisma internals when testing service rules.

## Integration tests
Use a real isolated PostgreSQL test DB for repository behavior, uniqueness, transactions, rollback, tenant filtering and concurrent invariants. A mocked Prisma call does **not** prove transaction or relational behavior.

## E2E tests
Use NestJS HTTP/auth/database composition where real request-level coverage matters: role/permission, tenant access, DTOs, cross-tenant attempts, payment recording, licence stage transitions and endpoint contracts. Do not duplicate every isolated unit scenario in E2E.

## Required domain scenarios
- Platform: overdue vs grace expiry, payment allocation, multiple unpaid invoices, manual suspension priority, quota concurrency.
- School: one customer/multiple cases, multiple class statuses, attempt history, resits, permit expiry/eligibility and partial completion.
- Security: cross-tenant access via direct IDs and nested relations, branch restrictions, unauthorized admins, suspended tenant exceptions.
- Persistence: DB constraints, duplicate submission, atomic rollback and read/write scoping.

## Time and nondeterminism
Inject or control clock for deadlines, grace periods, expiring permits and booking times. Test just-before/at/after boundaries. Avoid live external services and nondeterministic delays.

## Isolation and cleanup
Use an isolated test database, predictable factories, independent tests and safe cleanup. Never reset staging/shared/production databases. Ensure tests do not rely on execution order or stale data.

## Read details when relevant
- [test-matrix.md](test-matrix.md) — test layer and behavior matrix.
- [fixtures-and-mocks.md](fixtures-and-mocks.md) — factories, interface mocks, test DB setup.
- [examples.md](examples.md) — concrete cases and test outlines.

## Quality gate
- [ ] Critical success/failure behavior proved.
- [ ] Tenant-negative cases included where applicable.
- [ ] DB invariants tested against DB where appropriate.
- [ ] Historical records and concurrency covered for risky changes.
- [ ] No weakened/assertion-free tests.
