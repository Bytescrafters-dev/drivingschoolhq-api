---
name: backend-verification
description: Final verification gate for NestJS + Prisma backend work: inspect diffs, run relevant tests, lint/type/build, validate migrations, review tenant/security invariants, exercise runtime wiring and truthfully report results. Use after implementation and review.
---

# Backend Verification

## Rule
**Never claim a command passed unless it actually ran and succeeded.** Read `CLAUDE.md`, `package.json`, and repository scripts; do not assume npm/yarn/pnpm or test command names.

## Final verification procedure
1. Review `git status`, `git diff --stat`, final `git diff` and affected modules for unintended edits or secrets.
2. Identify affected domains and risk: tenant security, billing, Prisma, state transitions, scheduling, background jobs, ordinary API.
3. Run focused tests first; fix change-related failures.
4. For Prisma changes: format/validate/generate and inspect migration SQL; test against **isolated** DB using actual repository workflow.
5. Run appropriate lint, typecheck/build and broader tests available in the project.
6. For auth/DI/runtime changes, exercise actual Nest app/module or e2e HTTP contract if practical.
7. Re-review the final diff after fixes.
8. For substantial/high-risk changes, run independent `architecture-reviewer` and resolve valid findings.
9. Report commands actually run and their outcomes; clearly mark what could not be verified.

## Change-specific gates
- Tenant scoped changes: direct IDs, nested relationships, branch scope, counts and exports.
- Platform changes: platform actor permission, grace date boundary, manual suspension priority, remaining blocking invoices, audit.
- Payments: transaction correctness, idempotency, monetary accuracy, non-destructive adjustments.
- Exam/training: immutable attempts, class-level progression, scheduling conflicts, invalid transitions.
- Prisma: schema relations, migration safety, indexes, constraints, generated client, test DB.
- Background jobs: retries, duplicate execution, state re-check, commit/dispatch order.

## Verify real commands
Examples only, **not** instructions to assume scripts exist:
```bash
git status --short
git diff --stat
# choose actual commands from package.json, e.g.:
# yarn lint && yarn test && yarn build
# npx prisma validate && npx prisma generate
```
Never reset a production/staging/shared database for a test. Never claim deployment runtime works merely because TypeScript compiled.

## Verification is not test authoring
Use `backend-testing` during implementation to design tests. This skill confirms tests exist, runs them, inspects failures and validates changed behavior.

## Read details when relevant
- [verification-matrix.md](verification-matrix.md) — change class to required evidence.
- [completion-report.md](completion-report.md) — truthful concise reporting format.

## Required completion decision
- **Verified**: relevant required checks passed, change reviewed, no blocking issue.
- **Partially verified**: some checks not runnable; list precise limitations, avoid unqualified completion claim.
- **Blocked**: changed behavior fails required checks or known critical defect remains.
