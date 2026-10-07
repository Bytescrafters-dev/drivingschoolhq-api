# Schema and migration review

## Schema checklist
1. Define aggregate owner, tenant scope, cardinality and lifecycle.
2. Specify nullable fields intentionally; `?` changes business guarantees.
3. Use proper relation tables for many-to-many associations with their own state.
4. Decide whether deletion is allowed, restricted, soft, or historical.
5. Add compound unique keys at intended scope.
6. Index actual high-volume tenant, due-date, schedule and application queries.
7. Keep reference/master vehicle classes apart from tenant-specific applications.
8. Preserve applicant snapshots and past attempt/payment/issuance history.

## Illustrative constraints
```prisma
model ApplicationVehicleClass {
  id             String @id @default(uuid())
  applicationId  String
  vehicleClassId String

  @@unique([applicationId, vehicleClassId])
  @@index([vehicleClassId])
}
```
Note: duplicates may be intentionally allowed if distinct requested-class episodes/reapplications are modeled; confirm invariant first.

## PostgreSQL features
- Partial uniqueness (e.g., one active subscription) may require hand-written SQL; Prisma models alone may not express it.
- Database `CHECK` constraints may require manual migration SQL.
- Review migration naming, locks, default/backfill sequence, and unique constraint creation against existing records.

## Safe migration approach
When adding a non-null column on populated data, consider: add nullable → backfill → validate → enforce non-null; coordinate with staged application deployments if necessary.

Never run `prisma migrate reset` on shared, staging or production data. Use the scripts and deployment workflow already in the repository.
