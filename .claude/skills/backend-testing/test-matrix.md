# Test matrix

| Feature area | Unit | Integration | E2E |
| --- | --- | --- | --- |
| Tenant access evaluator | all blockers, grace boundary | persistence/atomic status changes | suspended routes vs allowed billing routes |
| Plan quota | effective limits, overrides | concurrent create/reservation | plan quota error response |
| Record tenant payment | amount/exception rules | payment+allocation+invoice+access atomicity | admin permission + mark paid endpoint |
| Tenant onboarding | validation/service coordination | one-transaction persistence, unique tenant | platform admin create tenant |
| Tenant-owned CRUD | service rules | tenant/branch scope of repo read/write/count | foreign tenant ID denied |
| Written/practical test | transition, reattempt number | attempt history, uniqueness | record result, unauthorized correction |
| Training scheduling | eligibility/conflict calculation | atomic overlapping bookings | schedule endpoint validation |
| File/document access | policy | storage metadata association | unauthorized signed URL denied |
| Licence issuance | class-level completion | issued class relation/history | complete use case |
| Scheduled billing job | due selection, idempotency | duplicate run/atomic transition | only when HTTP/runtime wiring requires |

## High-value negative tests
- Tenant A passes Tenant B's document/child record ID.
- Two parallel creates when quota has one free slot.
- Admin records payment twice with same idempotency/external reference.
- Invoice September paid but August beyond grace remains unpaid.
- All invoices paid while manual tenant suspension still active.
- Attempt #1 failed and #2 passed; #1 remains unchanged.
- One class passed, another failed; application remains active/partially fulfilled per policy.
- Permit expired between booking and execution; operation uses correct decision point.

## Test quality
Assert observable contracts and persisted state rather than private method call counts unless orchestration itself is under test. E2E tests should prove auth and validation wiring, not merely call services directly.
