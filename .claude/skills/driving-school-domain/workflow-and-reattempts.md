# Licence workflow and reattempt policy

## Primary lifecycle
```text
DRAFT → ACTIVE → [ON_HOLD] → COMPLETED | CANCELLED | ABANDONED
```
Overall application lifecycle should stay compact; represent detailed stages through medical, exams, permits, class progress and event history.

## Conditional dependencies
A new application may require medical evidence, theory assessment and learner permit before practical eligibility. An add-class/upgrade application may use different rules. Do not hardcode a universal linear order; centralize required steps and eligibility by application type, vehicle class and effective rules.

## Written attempts
```text
WrittenTest
  ├── Attempt #1: FAILED
  ├── Attempt #2: ABSENT
  └── Attempt #3: PASSED
```
Persist attendance, result, source reference and attempt time separately. The parent summarizes latest state based on attempts. Rebooking preserves past attempts and may incur a school/customer fee.

## Practical attempts per class
```text
Application A + B
  ├── A → lessons → attempt #1 PASS
  └── B → lessons → attempt #1 FAIL → additional lessons → attempt #2 PASS
```
Partial completion cannot be accurately represented by one `application.status = FAILED`. Choose a policy for when application can be marked COMPLETED if B remains pending and A has an issued class; do not infer it silently.

## Permit expiry
- Represent issuance/expiry and replacement/superseding history.
- Disallow scheduling where actual DMT/permit eligibility rules require a valid permit.
- Do not silently extend an expired permit inside the SaaS.
- Expired and reissued permits might affect eligibility dates; rules must be explicitly maintained and verified.

## Exam result corrections
Never mutate a historical result without trace. If verified corrections are permitted, preserve who changed it, why, timestamp and previous value; prefer a correction/void entry when appropriate.

## Licence outcome
Distinguish actual licence issuance from passing a test. `DrivingLicence` is the persistent licence; `LicenceIssuance` captures the transaction; `LicenceClass` captures granted classes. Do not mark a case complete merely because its final practical test is passed unless your domain closure policy allows it.

## Rescheduling
Separate booking status (`SCHEDULED`, `CANCELLED`, `NO_SHOW`) from examination result (`PASS`, `FAIL`, `PENDING`). Absence is not necessarily a failed exam attempt unless the rules say so.

## Time policy
Store authoritative timestamps/dates accurately; use a configured zone (often Asia/Colombo for Sri Lankan operations) for local-day scheduling/billing semantics. Calculate expiry with a tested clock/date abstraction.
