# Verification matrix

| Change | Minimum useful checks |
| --- | --- |
| Controller/DTO | tests for validation, role, HTTP contract; lint/type/build |
| Service/domain | targeted unit tests incl. bad state; lint/type/build |
| Repository/query | integration tests + tenant scoping + Prisma validation |
| Schema/migration | Prisma validation/generation, migration SQL review, isolated DB migration test |
| Auth/RBAC/tenant access | negative E2E/integration tests, permissions, foreign-ID access |
| Platform billing | balance/allocation, duplicate payment, grace boundary, multi-invoice/manual-block restoration |
| Plan quota | over-limit and concurrent create tests |
| Training scheduling | conflicts, vehicle/instructor class eligibility, concurrency |
| Tests-only | run changed tests, check they genuinely exercise behavior |
| Background jobs | duplicate invocation, retry classification, safe state recheck |

## Diff inspection checklist
- no accidental secrets/credentials
- no debug logging or overly broad permissions
- no Prisma access added in controllers/business services
- no unscoped tenant query / relation attachment
- no changed historical state without audit
- no unsafe `onDelete: Cascade` across important records
- no accidental unrelated formatting churn
- migration SQL consistent with intended DB state

## Reviewer engagement
Invoke independent `architecture-reviewer` for substantial or high-risk changes when available. Ask it to focus on specific changed modules, security boundaries, transaction semantics and regression risks. Evaluate findings instead of blindly applying suggestions.
