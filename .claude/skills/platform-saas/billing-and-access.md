# Billing, grace periods and effective tenant access

## Invoice lifecycle
```text
DRAFT → ISSUED → PARTIALLY_PAID / PAID
                   ↓ due passed with balance
                OVERDUE → PARTIALLY_PAID / PAID
        (VOID via authorized/audited administrative correction)
```
`TenantAccess.SUSPENDED` is **not** an invoice status.

## Due/grace semantics
On invoice issuance, persist a due timestamp and resolved grace period/deadline from the applicable subscription terms. Clarify whether the grace end is inclusive/exclusive (e.g., block when `now >= graceEndsAt`), and test the boundary. Do not recompute historical invoice grace deadlines from newly edited plan defaults.

## Effective tenant-access priority
Recommended policy:
1. Tenant terminated/cancelled/invalid provisioning → no normal business access.
2. Any active manual/security suspension → SUSPENDED.
3. Any unpaid blocking invoice beyond grace → SUSPENDED.
4. Any overdue unpaid invoice within grace → GRACE_PERIOD.
5. Otherwise → ACTIVE.

This is a business policy to confirm before implementation; respect explicitly configured exceptions and administrative override authorization. Never restore access based on a single paid invoice without reevaluation.

## Recording payment
Use a domain operation with these steps:
1. Platform billing permission and current invoice validation.
2. Validate amount, currency, payment reference and duplicate/idempotency key.
3. Create immutable `TenantPayment` and allocation(s).
4. Recalculate outstanding amounts and invoice status.
5. Reevaluate **all** blocking invoices plus manual suspensions.
6. Persist audit/business event in same appropriate transaction.
7. After commit, send receipts/access notifications via retryable dispatch.

If a manual payment was entered incorrectly, preserve financial audit via a reversal/adjustment, not direct destructive deletion.

## Example
Invoice August unpaid beyond grace; September invoice marked PAID. Tenant remains SUSPENDED because August still blocks. Once August is paid, billing block clears; however an active manual suspension still prevents access restoration.

## Partial payments
Partial payment reduces balance but does not necessarily remove grace/suspension. Policy for whether tiny balances or payment promises change blocking status must be explicit. Never infer that any payment means `PAID`.

## Financial correctness
Invoice status and balances are derived from allocations; maintain strong transactional guarantees. Ensure concurrent payment recordings can't overallocate or double-charge. Distinguish internal manual reconciliation from actual electronic settlement.

## UI/API exception
A suspended tenant may authenticate to view billing/support/renewal details as policy allows. Protect all normal school business endpoints on the backend.
