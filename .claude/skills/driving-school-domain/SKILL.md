---
name: driving-school-domain
description: Model and implement Sri Lankan driving-school operations, including customers, licence applications, vehicle classes, documents, medical certification, written exams, learner permits, lessons, practical attempts, licensing, scheduling and school-to-student billing. Use whenever these business workflows change.
---

# Driving-School Domain

## Mission
Preserve the licence case as the central business transaction while allowing different vehicle classes and attempts to progress independently. Treat DMT/NTMI as **external authorities**, not tables controlled by this SaaS.

**Before implementing**, read `CLAUDE.md`, inspect the relevant entities/use cases and confirm which business rules are official requirements versus school-specific practices. Do not invent DMT/NTMI APIs or treat illustrative age, waiting-period, or document rules as current law.

## Aggregate ownership
- `Customer`: reusable tenant-owned person/profile (not automatically a login).
- `LicenceApplication`: one licence-related business case/job for that customer.
- `ApplicantSnapshot`: identity/contact as recorded for this case.
- `ApplicationVehicleClass`: a requested class within an application and its independent progress.
- `MedicalAssessment`, `WrittenTest`, `LearnerPermit`: application-side records with history and applicable class/requirement coverage as needed.
- `TrainingPlan` and `PracticalTest`: typically owned by an application vehicle class.
- `DrivingLicence`, `LicenceClass`, `LicenceIssuance`: persistent entitlement/result vs issuance transaction.
- `CustomerInvoice`/`CustomerPayment`: school charges to students, **not** SaaS charges to schools.

## Invariants
1. Customer can have many applications; one failed attempt does **not** create a new customer or application.
2. Application can request multiple classes with different outcomes.
3. Record individual written/practical attempts; do not overwrite earlier failures or absences.
4. Keep overall application status broad; do not represent every stage in one enum.
5. A customer's current details must not silently rewrite historical application snapshots.
6. Official outcomes are recorded/verified externally; SaaS does not claim to issue permits, passes or licences on behalf of DMT.
7. School-configurable training requirements are not identical to official regulatory eligibility rules.
8. Every tenant-owned business record must be scope-checked (apply `multi-tenancy-security`).

## Workflow approach
```text
Customer → LicenceApplication (+ requested classes)
  → documentation / medical / written assessment as applicable
  → learner permit
  → class-specific training and practical attempts
  → evidence of class completion / licence issuance
  → case completion or partial/held/cancelled disposition
```
This is a **conceptual journey**, not a mandated sequential workflow. Some activities overlap; rules differ by application type, vehicle class and current authority requirements. Centralize eligibility, record manual official outcomes, and maintain a timeline.

## Data flow
- Do not copy NIC/name/DOB to every child entity by default; use references and intentional submitted-data snapshots.
- Medical: identity/appointment/reference/result/certificate dates, not unnecessary clinical details.
- Written exam: eligibility, booking, attempts, official result and supporting reference.
- Permit: number, validity, coverage and document evidence.
- Training: student class, instructor/vehicle suitability, sessions and attendance.
- Practical: class, eligibility, booked vehicle/instructor, attempts and outcome.
- Licence: issuance transaction and successfully granted classes.

## Errors and transitions
Use explicit use cases (`recordMedicalOutcome`, `recordWrittenAttempt`, `scheduleLesson`, `recordPracticalAttempt`, `recordLicenceIssuance`). Reject invalid transitions with stable domain errors; preserve override/audit procedures where business operations require correction.

## Read details when needed
- [entities-and-relationships.md](entities-and-relationships.md) — domain ownership, relationships, field groups.
- [workflow-and-reattempts.md](workflow-and-reattempts.md) — transitions, partial completion, edge cases.
- [data-and-documents.md](data-and-documents.md) — data propagation, evidence and stage inputs.
- [examples.md](examples.md) — realistic multi-class job and use cases.

## Completion gate
- [ ] Correct aggregate owns data and history.
- [ ] Class-specific progress stays separate from overall case status.
- [ ] Requirements are authoritative vs configurable vs internal, not conflated.
- [ ] Reattempts, expiry and partial outcomes are covered.
- [ ] Foreign resources cannot be linked across tenants.
- [ ] Meaningful business tests and audit events added.
