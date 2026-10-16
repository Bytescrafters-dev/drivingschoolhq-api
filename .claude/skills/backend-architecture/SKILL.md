---
name: backend-architecture
description: Design and implement NestJS modular-monolith features using thin controllers, explicit application services, repository interfaces, DI tokens, domain ownership and deliberate module dependencies. Use for controllers, services, modules, APIs, orchestration and architecture refactoring.
---

# Backend Architecture

## Goal

Keep features in the correct domain, consistent with the repository's existing NestJS conventions. **Read `CLAUDE.md` first.** Inspect nearby implementations before deciding a design.

## Required implementation sequence

1. Identify the actor: platform admin, tenant user, or trusted system job.
2. Identify the owning domain, aggregate and authoritative records.
3. Identify tenant/branch/customer/platform scope and cross-module dependencies.
4. Find comparable controller, service, repository, DTO, module and tests.
5. Specify invariants, error paths, transaction boundaries and tests before editing.
6. Choose the smallest change compatible with existing patterns.
7. Implement, then self-review with `backend-testing` and `backend-verification`.
8. Do not add comments and emojis everywhere. Comment only if there is something critical to note.

## Default dependency direction

```text
Controller → Application/Domain Service → Repository Interface
                                             ↑
                               DI token / Nest provider binding
                                             ↑
                               Prisma Repository Implementation → Prisma
```

- Controller: HTTP concerns, authenticated actor/context, DTO validation, service call, response mapping.
- Service: use cases, domain rules, orchestration, transaction decisions.
- Repository interface: persistence operations expressed in domain language, not Prisma's query API. Always create inside a directory 'interfaces', inside the module.
- Repository implementation: owns Prisma calls and query mapping. Always create inside a directory 'infra', inside the module.
- Module: owns registration/exports of its public services and repository tokens.
- Follow the actual repository layout instead of generating parallel abstractions.
- Any other files created to include interfaces only, should be also created inside the 'interfaces' directory.
- Any other supporting files should be placed inside a directory 'common' inside the module.
- In the root level, there should be only module, service, and controller files and any corresponding tests.

## Non-negotiable domain boundaries

- **Platform**: platform admins, tenants, plans, subscriptions, entitlements, SaaS invoices/payments, access and platform audit.
- **Tenant operations**: tenant users/roles, branches, instructors, vehicles.
- **Customer & licence case**: customers, applications, classes, medical, exams, permits, training, licences.
- **Customer billing**: school-to-student invoices/payments, distinct from platform-to-school billing.
- **Shared supporting**: scheduling, notifications, documents and audit, each with clear ownership.

Do not have one domain import another module's private repository or Prisma model implementation. Prefer a narrow exported use-case service or a read-only interface. Reconsider module responsibilities before using `forwardRef()`.

## Business rules and persistence

- Give operations business names: `recordTenantPayment`, `scheduleTrainingSession`, `recordWrittenTestResult`.
- Validate actor permission, resource ownership, state transition and relevant entitlement separately.
- Keep customer profile separate from application-time snapshots; keep attempts immutable as history.
- Coordinate multi-write invariants within a transaction; avoid network calls inside it.
- Use events/jobs for post-commit effects only when justified; do not introduce microservices or a generic workflow engine.

## API design

- Use request DTO validation plus independent domain validation.
- Do not leak Prisma errors, internal stack traces or cross-tenant existence.
- Prefer explicit error codes such as `PLAN_LIMIT_REACHED`, `INVALID_APPLICATION_STATE`.
- Use established exception/response patterns, not a new global framework.

## Detailed references (read only when relevant)

- [module-boundaries.md](module-boundaries.md) — module ownership, public APIs, coupling rules.
- [SOLID.md](SOLID.md) — applying SOLID pragmatically in NestJS.
- [examples.md](examples.md) — DI-token module and cross-module orchestration examples.

## Completion checklist

- [ ] Correct domain owns the feature and data.
- [ ] No Prisma queries or business rules in controllers.
- [ ] Services depend on appropriate repository interfaces.
- [ ] Auth scope and tenant boundaries verified.
- [ ] Business failures and rollback paths handled.
- [ ] Tests and final verification performed.
