# SOLID guidelines for NestJS

## Single responsibility
Controllers map HTTP and services own use cases. A 1,000-line `ApplicationService` handling medical, tests, permits and invoices violates this boundary; split by use case or subdomain.

## Open/closed
Prefer injecting a `NotificationSender` adapter when adding new channels. Do not create pluggable strategies for two simple `if` statements without a credible extension point.

## Liskov substitution
Repository implementations must preserve interface guarantees, particularly tenant scoping and not-found behavior; do not create weaker admin shortcuts.

## Interface segregation
Expose narrow interfaces (`FindTenantAccess`, `RecordPayment`) rather than one enormous repository/service used by unrelated modules.

## Dependency inversion
Business services depend on a repository interface via NestJS injection token. Prisma implementation and persistence mapping remain infrastructural. Prefer explicit provider registration to `forwardRef()` or dynamic service locators.

## Pragmatic constraints
- Follow established folder layout, naming, DTO, exception and transaction conventions.
- Avoid unnecessary BaseService/BaseRepository, reflection-heavy factories and generic workflow builders.
- Do not construct a future-proof framework without an immediate use case.
