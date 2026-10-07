# Fixtures, DI mocks and test database

## Test builders
Create reusable constructors for tenant, user, customer, application, class, invoice, payment and exam attempts. Make tenant ownership explicit in every fixture. Defaults must be realistic but obvious; use focused overrides per test.

Example intent:
```ts
const tA = makeTenant();
const tB = makeTenant();
const customerA = makeCustomer({ tenantId: tA.id });
const instructorB = makeInstructor({ tenantId: tB.id });
```

## Mock by interface
NestJS services should inject repository DI tokens. Unit tests should override those providers with narrow doubles conforming to the interface rather than spying on PrismaService from domain tests.

## Integration tests
- Use disposable PostgreSQL DB/isolated schema with migrations applied using repository's test workflow.
- Verify real uniqueness and query scoping.
- Keep tests deterministic and tear down safely.
- Avoid using the developer's actual DB connection or `migrate reset` against any shared instance.

## Transaction tests
Force one write within a multi-write use case to fail, then confirm none of the writes were committed. Test the same transaction client is used across all participating repositories.

## Clock
Use an injected clock or test time abstraction. Freeze `now` and verify exact due/grace/expiry boundaries; do not derive expectations from the wall clock during test execution.

## External services
Mock SMS/email/payment gateway boundaries in unit tests. Integration-test adapters separately if needed; verify post-commit messages are not dispatched for rolled-back operations.
