# Prisma query patterns

## Tenant-scoped lookups
Prefer an actual tenant predicate in the database query:
```ts
const customer = await prisma.customer.findFirst({
  where: { id: customerId, tenantId },
  select: { id: true, tenantId: true, fullName: true },
});
```
Check whether schema supports a compound `findUnique` key when that better expresses the invariant. Do not use `findUnique({where:{id}})` for a tenant-accessible endpoint merely because UUIDs are hard to guess.

## Nested resource ownership
A child may have no tenantId but belong to a tenant via its application:
```ts
const attempt = await prisma.practicalTestAttempt.findFirst({
  where: {
    id: attemptId,
    practicalTest: {
      applicationVehicleClass: { application: { tenantId } },
    },
  },
});
```
Adapt relation names to actual Prisma models. Validate parent and child associations on both reads and writes.

## Write scoping
When updating a tenant record, prefer a tenant-scoped `updateMany` with affected-row check, or a compound unique key in `update`, rather than an unsafe global `update({where:{id}})`. If a state precondition matters, include it in the atomic predicate.

## Pagination
- Use deterministic ordering with stable tie-breakers (`createdAt`, `id`).
- Prefer cursor pagination for large chronological data sets; use offset for small admin views if needed.
- Carry the exact same tenant/scope filters into `count`, `findMany` and export paths.
- Whitelist filter/sort fields; never build arbitrary untrusted Prisma structures from client JSON.

## Performance
- Avoid N+1 queries in list endpoints.
- Select only needed fields; scrutinize deep `include` chains.
- Index common `tenantId + status/date/foreignKey` lookup patterns when justified.
- Inspect `EXPLAIN` / query plans for expensive production queries rather than indexing blindly.

## Repositories
Return mapped domain/read DTO types consistent with existing conventions, not unrestricted Prisma internals.
