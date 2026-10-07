# Transactions, concurrency and idempotency

## Transaction ownership
One application use case owns the transaction; participating repositories must use the same Prisma transaction client. Don't accidentally call the global Prisma client in the middle of a transaction.

Illustrative pattern (adapt to your repository's UoW API):
```ts
await unitOfWork.run(async (repos) => {
  await repos.payments.create(payment);
  await repos.invoices.recalculate(invoiceId);
  await repos.audit.append(event);
});
```

## Race: limit enforcement
Naive count-then-insert allows concurrent requests to exceed `maxBranches`. Enforce strict caps using an atomic quota reservation/counter, tenant-level lock, or serializable transaction with retry (where supported). A plain pre-check in a guard is insufficient under concurrent writes.

## Race: exam attempts
Two requests may both compute `attemptNumber = max + 1`. Use a unique `(writtenTestId, attemptNumber)` / `(practicalTestId, attemptNumber)` constraint and retry-safe sequence allocation. A duplicate request must not create two attempts.

## Billing
- Prevent double invoice generation per tenant subscription and billing period with a unique idempotency key/constraint.
- Ensure external payment reference uniqueness as appropriate to gateway/tenant scope.
- For manual payment recording, record who made the entry and preserve immutable payment history; corrections via reversal/adjustment not destructive delete.
- Reevaluate access based on *all* outstanding blocking invoices and manual suspension.

## External effects
Do not send email or enqueue a job before a transaction can still roll back. For durable delivery use an outbox, or post-commit dispatch plus reconciliation if acceptable. Handle at-least-once execution idempotently.

## Error handling
Translate unique constraint errors into meaningful domain conflicts; detect retryable serializable/deadlock failures based on DB/Prisma semantics and bound retries. Never blanket-retry non-idempotent domain actions.
