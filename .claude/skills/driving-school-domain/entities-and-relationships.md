# Driving-school domain entities and relationships

## Core relationship picture
```text
Tenant 1 ── N Customer 1 ── N LicenceApplication
                           ├── 1 ApplicantSnapshot (or versioned snapshots)
                           ├── N ApplicationVehicleClass ──> VehicleClass (reference)
                           │          ├── 0..N TrainingPlan ── N TrainingSession
                           │          └── 0..N PracticalTest ── N PracticalTestAttempt
                           ├── N ApplicationDocument ──> Document
                           ├── N MedicalAssessment
                           ├── N WrittenTest ── N WrittenTestAttempt
                           ├── N LearnerPermit
                           ├── N ApplicationEvent
                           ├── N CustomerInvoice ── N CustomerInvoiceItem
                           └── N LicenceIssuance ──> DrivingLicence ── N LicenceClass
```
Cardinalities are **conceptual defaults**. Confirm any exact `1:1` vs `1:N` constraint per actual workflow and avoid locking out resits/renewals, permit replacements or distinct exam coverage.

## Entity data groups

| Entity | Core fields / responsibilities |
| --- | --- |
| Customer | tenantId, identity number(s), names, DOB, contact/address; deduplication within tenant |
| LicenceApplication | tenantId, customerId, branchId, type, case number, broad status, coordinator, dates |
| ApplicantSnapshot | applicationId, submitted identity/contact values, capturedAt and possibly version/reference |
| ApplicationVehicleClass | applicationId, vehicleClassId, per-class progress, completion/cancellation |
| VehicleClass | code, name, category descriptions, versioned/regulatory policy references |
| Document | storage key, type, metadata, verification and expiry; secure access |
| ApplicationDocument | applicationId, documentId, requirement, validation/verification status |
| MedicalAssessment | applicationId, booking, provider/NTMI reference, outcome, certificate validity |
| WrittenTest | applicationId, requirement/coverage, overall test state |
| WrittenTestAttempt | parentId, attemptNumber, booking, attendance, recorded result, evidence |
| LearnerPermit | applicationId, permit/reference number, issue/expiry, classes/coverage, supersedes |
| TrainingPlan | applicationVehicleClassId, package/lesson requirements, status |
| TrainingSession | planId, instructorId, vehicleId, scheduled/actual time, attendance, result |
| PracticalTest | applicationVehicleClassId, eligibility/current state |
| PracticalTestAttempt | practicalTestId, attemptNumber, date, vehicle/instructor, result and evidence |
| DrivingLicence | customerId, licence number/validity, persistent document |
| LicenceClass | licenceId, vehicleClassId, validity of granted class |
| LicenceIssuance | applicationId, licenceId, transaction type/date and record/reference |
| CustomerInvoice | tenantId, applicationId or customerId, amounts, state, due dates |
| CustomerPayment | tenantId, amount, method/reference, receipts/allocations |
| ApplicationEvent | chronological business event with actor, time and safe metadata |

## Teaching rule
`Customer.status = 'PRACTICAL_FAILED'` is invalid ownership. Status lives with the attempt/test/application class, with application remaining active unless explicitly abandoned or terminated.

## Vehicle classes and written coverage
A written exam/permit may cover more than one selected vehicle class. Do not automatically create a duplicate written test per class unless confirmed by business rules. If needed, represent `WrittenTestCoverage` / `PermitClass` join records to document exactly which classes a result covers.

## Ownership boundaries
- `Instructor` may reference `TenantUser` but is a separate operational entity.
- Vehicle belongs to tenant/branch and supports classes; validate compatibility.
- Billing includes application fees, lesson fees, reattempt fees, and adjustments; never conflate with SaaS subscription invoices.
- Scheduling holds reservations while actual domain entities hold test/training outcomes.
