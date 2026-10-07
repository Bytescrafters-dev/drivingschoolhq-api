# Documents and stage data exchange

## Documents
Common requirements may include identity documents (NIC/passport), birth certificate, existing licence, application forms, medical certificate, learner permit, test references and issuance evidence. The exact mandatory list depends on transaction type, vehicle class, authority office and current rules; it must be validated before hardcoding.

Prefer:
```text
Document ── ApplicationDocument ── LicenceApplication
         └── DocumentRequirement (configuration/reference)
```
Keep original file metadata and verification status. Documents uploaded by a user are not automatically official/verified.

## Data-flow matrix

| Stage | Reads from authoritative domain records | Produces/records |
| --- | --- | --- |
| Create application | Customer, selected type/classes, tenant/branch | LicenceApplication, ApplicantSnapshot, class selections |
| Documentation | ApplicantSnapshot, document requirement rules | ApplicationDocument verification/evidence |
| Medical tracking | Applicant identity/contacts, application details | appointment/reference, certificate outcome and dates |
| Written test | application/requirement coverage, medical where required | booking and immutable attempt outcome |
| Learner permit | official written outcome as required, selected classes | permit number, validity, coverage and document |
| Training | application class, permit policy, instructor and vehicle | sessions, attendance, progress |
| Practical | class eligibility, valid authorizations, training, booking | exam attempt with attendance/result/evidence |
| Licence issuance | official class outcomes and applicant record | licence number, class validity, issuance transaction |
| School billing | package, extra sessions, reattempt fees | customer invoices and payments |

## Duplication policy
- `Customer` stores current profile.
- `ApplicantSnapshot` stores facts submitted/used at a point in time.
- Stage entities reference application/customer IDs, not copy name/NIC on every row.
- Official references and issuance results may be intentionally snapshotted for audit.

## Medical privacy
Do not record diagnoses by default; track fitness/certificate metadata required by the school. Restrict sensitive document access and avoid unnecessary disclosure to instructors and billing staff.

## Official integration status
Without a verified NTMI/DMT integration, the system **tracks** appointments, official references, evidence and manually entered verified results. It does not automatically submit or issue regulatory documents.
