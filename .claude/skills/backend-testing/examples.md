# Testing examples (pseudocode; adapt to existing runner)

## Access evaluator — unit
```ts
it('keeps tenant suspended when a second invoice remains beyond grace', () => {
  const result = evaluateTenantAccess({
    invoices: [paidSeptember, unpaidAugustBeyondGrace],
    activeManualSuspensions: [],
    now: fixedNow,
  });
  expect(result.status).toBe('SUSPENDED');
});
```

## Tenant scoping — integration
```text
Arrange T1/T2, application in T2, valid T1 actor.
Act via T1-scoped repository method using the T2 application ID.
Assert null/not found and no T2 data changed.
Repeat for nested relation attachments and `count` if affected.
```

## Payment — integration
```text
Arrange overdue invoice, valid admin.
Act record full payment.
Assert payment exists, balance 0, invoice PAID,
      tenant reevaluated, audit recorded.
Repeat identical idempotency key.
Assert only one payment/credit was applied.
```

## Exam history — integration
```text
Arrange practical test with attempt 1 FAIL.
Act create/record attempt 2 PASS.
Assert attempt 1 unchanged and attempt 2 preserved;
      class summary passed, application status not overwritten incorrectly.
```

## Quota concurrency — integration
```text
Arrange remaining staff capacity = 1.
Act two concurrent create requests.
Assert one successful creation at most; total active count <= maximum.
```
