# Domain workflow examples

## Multi-class job
```text
Customer Kasun (tenant T)
└── Application APP-104: NEW_LICENCE
    ├── Class A
    │   ├── TrainingPlan → 3 sessions
    │   └── PracticalAttempt #1 PASS
    ├── Class B
    │   ├── TrainingPlan → 4 sessions
    │   └── PracticalAttempt #1 FAIL → #2 PASS
    ├── MedicalAssessment (certificate recorded)
    ├── WrittenTest → Attempt #1 PASS
    ├── LearnerPermit (validity and covered classes recorded)
    ├── CustomerInvoice + Payments
    └── LicenceIssuance → DrivingLicence + granted classes
```
This is illustrative, not a regulatory guarantee of required lessons or permitted exam structure.

## Reattempt use case
`recordPracticalAttemptResult(tenantId, applicationClassId, attemptId, result)` must:
1. Verify actor permission, tenant/branch scope, class ownership and current attempt state.
2. Record outcome and evidence without overwriting older attempts.
3. Update or derive current practical/class status.
4. Emit application event/audit record atomically where appropriate.
5. Schedule any optional notifications after commit.
6. Prevent duplicate result submission or require an audited correction workflow.

## Scheduling use case
`scheduleTrainingSession` must establish application class, instructor and vehicle belong to the tenant, that qualification/capacity/schedule constraints allow the booking, and that concurrent bookings cannot produce collisions.

## Invalid data placement
Avoid `Customer.medicalPassed`, `Customer.trialDate`, `LicenceApplication.categories='A,B'` and overwriting `WrittenTest.result` without attempt history.
