# Backend API Agent Guide

You are the primary backend engineering agent for this repository.

This repository contains a **multi-tenant SaaS monolithic API** implemented with:

- **NestJS**
- **TypeScript**
- **Prisma ORM**
- **PostgreSQL**
- A **modular monolith** architecture

The product is a SaaS platform for **Sri Lankan driving schools**.

Read this file before making architectural, domain, database, authorization, billing, workflow, or cross-module changes.

---

# 1. Primary Responsibility

Own backend work from requirement analysis through implementation, review, testing, and verification.

For every meaningful change:

1. Understand the business requirement.
2. Identify the affected domain/module.
3. Inspect the existing implementation.
4. Find existing patterns before creating new ones.
5. Determine tenant scope and actor type.
6. Identify relevant business rules and invariants.
7. Plan the implementation.
8. Implement using existing architecture and conventions.
9. Update Prisma schema/migrations only when required.
10. Add or update tests.
11. Self-review the changes.
12. Use an independent review subagent for substantial or high-risk changes when available.
13. Fix identified issues.
14. Run relevant verification.
15. Report what changed, important decisions, and any remaining risks.

Do not report completion until verification is finished.

---

# 2. Architecture

The API is a **modular monolith**.

Do not introduce microservices, distributed messaging infrastructure, or unnecessary network boundaries unless explicitly required.

Prefer strong domain/module boundaries inside the monolith.

High-level module structure should evolve around:

```text
src/
├── platform/
│   ├── admin-auth/
│   ├── admin-users/
│   ├── tenants/
│   ├── plans/
│   ├── subscriptions/
│   ├── entitlements/
│   ├── tenant-access/
│   ├── billing/
│   └── audit/
│
├── tenant/
│   ├── auth/
│   ├── users/
│   ├── roles/
│   ├── permissions/
│   ├── branches/
│   ├── instructors/
│   └── vehicles/
│
├── customers/
│
├── licence-applications/
│   ├── applications/
│   ├── vehicle-classes/
│   ├── documents/
│   ├── medical/
│   ├── written-tests/
│   ├── learner-permits/
│   ├── training/
│   ├── practical-tests/
│   └── licences/
│
├── customer-billing/
├── scheduling/
├── notifications/
└── audit/
```

This structure is a domain guide, not a requirement to create empty modules.

Create modules only when functionality exists.

---

# 3. Core Domain Model

The system has two major business worlds connected by `Tenant`.

```text
PLATFORM DOMAIN
    │
    ▼
Tenant
    │
    ▼
DRIVING SCHOOL DOMAIN
```

## Platform domain

Responsible for operating the SaaS itself.

Core concepts include:

- PlatformAdminUser
- PlatformRole
- PlatformPermission
- Tenant
- TenantContact
- PricePlan
- PlanLimit
- PlanFeature
- TenantSubscription
- TenantLimitOverride
- TenantInvoice
- TenantInvoiceItem
- TenantPayment
- TenantAccess
- TenantSuspension
- PlatformAuditLog

## Driving-school domain

Responsible for the tenant's operational business.

Core concepts include:

- TenantUser
- Role
- Permission
- Branch
- Instructor
- Vehicle
- Customer
- LicenceApplication
- ApplicantSnapshot
- ApplicationVehicleClass
- ApplicationStage
- Document
- ApplicationDocument
- MedicalAssessment
- WrittenTest
- WrittenTestAttempt
- LearnerPermit
- TrainingPlan
- TrainingSession
- TrainingProgress
- PracticalTest
- PracticalTestAttempt
- DrivingLicence
- LicenceClass
- LicenceIssuance
- ServicePackage
- CustomerInvoice
- CustomerInvoiceItem
- CustomerPayment
- Appointment
- Notification
- ApplicationEvent
- AuditLog

---

# 4. Tenant Is the Main Boundary

`Tenant` represents one driving-school organization using the SaaS.

Every tenant-owned operational record must be safely scoped to a tenant, either directly or through a parent aggregate whose tenant ownership is unambiguous.

Never trust a client-provided `tenantId` without validating it against the authenticated context.

Prefer tenant context derived from authentication/session/token information.

Examples of tenant-owned data:

- TenantUser
- Branch
- Instructor
- Vehicle
- Customer
- LicenceApplication
- ServicePackage
- CustomerInvoice
- TrainingSession

Platform-level records such as `PlatformAdminUser` and `PricePlan` are not tenant-owned.

When querying tenant-owned data, always ensure cross-tenant access is impossible.

---

# 5. Actor Types Must Remain Separate

The system has three distinct identity concepts.

```text
PlatformAdminUser
    ↓ manages SaaS platform

TenantUser
    ↓ operates a driving school

Customer
    ↓ receives driving-school services
```

Do not collapse these into one generic `User` entity.

In particular:

- Platform admins do not belong to a tenant.
- Tenant users belong to a tenant.
- Customers are business-domain people, not authentication users.
- If a customer portal is introduced later, create a separate authentication concept linked to `Customer`.

---

# 6. Platform Administration Rules

Platform admins can manage tenants and SaaS commercial configuration.

Typical platform actions include:

- Create tenant
- Update tenant
- Select/change price plan
- Create subscription
- Configure tenant-specific plan overrides
- View usage
- Generate/view tenant invoices
- Record tenant payments
- Suspend/restore tenant access
- View platform audit history

Platform-admin authorization must be independent from tenant RBAC.

Do not use tenant roles such as `OWNER` or `ADMIN` to represent platform admins.

---

# 7. Plan, Entitlement, and Usage Rules

A `PricePlan` describes commercial offerings.

Use separate concepts for:

## Quantitative limits

Examples:

- Maximum staff users
- Maximum branches
- Maximum instructors
- Maximum vehicles
- Maximum storage
- Maximum active customers

Represent these as plan limits rather than hardcoding plan-specific checks throughout business modules.

## Feature entitlements

Examples:

- Advanced reporting
- API access
- SMS notifications
- Multi-branch support

Represent these separately from numeric limits.

Do not write business logic such as:

```ts
if (tenant.plan === 'PROFESSIONAL') {
  // ...
}
```

Instead use entitlement/plan-access services such as:

```ts
planAccessService.canCreateBranch(tenantId)
planAccessService.canCreateStaffUser(tenantId)
planAccessService.hasFeature(tenantId, FeatureCode.ADVANCED_REPORTING)
```

Plan enforcement must happen on the backend.

Frontend restrictions alone are never sufficient.

---

# 8. Tenant Access and Billing Suspension

Tenant business access is separate from user-account status.

Do not disable every tenant user because an invoice becomes overdue.

Example:

```text
TenantUser.status = ACTIVE
TenantAccess.status = SUSPENDED
```

Tenant-access states may include:

- ACTIVE
- GRACE_PERIOD
- SUSPENDED

Suspension reasons may include:

- PAYMENT_OVERDUE
- MANUAL_ADMIN_SUSPENSION
- SUBSCRIPTION_CANCELLED
- COMPLIANCE
- OTHER

Normal access evaluation should conceptually answer:

```text
1. Is the tenant allowed to use the SaaS?
2. Does the plan allow this feature/resource?
3. Does the authenticated tenant user have permission?
```

---

# 9. SaaS Billing Rules

Platform billing is:

```text
SaaS Platform → Tenant
```

Keep this completely separate from driving-school customer billing.

Use clear names such as:

```text
TenantInvoice
TenantPayment
```

for platform billing.

Use:

```text
CustomerInvoice
CustomerPayment
```

for student/customer billing.

Never reuse one invoice/payment aggregate for both.

## Tenant invoice lifecycle

Typical states:

- DRAFT
- ISSUED
- PARTIALLY_PAID
- PAID
- OVERDUE
- VOID

Suspension is not an invoice status.

## Grace period

A due invoice may enter a configured grace period.

Conceptually:

```text
ISSUED
  ↓ due date passes
OVERDUE
  ↓ grace period
GRACE EXPIRED
  ↓
TenantAccess = SUSPENDED
```

If payment is recorded, access must be recalculated from all blocking invoices.

Never restore access just because one invoice was marked as paid.

Use a domain service similar to:

```ts
billingService.evaluateTenantAccess(tenantId)
```

that considers all outstanding/blocking invoices and manual suspensions.

## Recording payments

"Mark invoice as paid" must create a `TenantPayment` record.

Do not only update:

```ts
invoice.status = 'PAID'
```

Payment recording should preserve:

- amount
- payment date
- payment method
- external reference
- admin who recorded it
- notes if relevant

Invoice status and balance should be derived/recalculated from recorded payments.

---

# 10. Tenant Subscription Rules

Do not model a subscription as only:

```ts
tenant.pricePlanId
```

Use a proper `TenantSubscription`.

Preserve subscription history.

A tenant may move through plans over time.

Snapshot agreed commercial values such as:

- agreed price
- currency
- billing period
- grace period if tenant-specific

Do not allow historical invoices to change when the current plan catalogue changes.

Support tenant-specific overrides where appropriate rather than creating a new plan for every exception.

---

# 11. Driving-School Core Transaction

`LicenceApplication` is the central operational business transaction.

`Customer` represents the person.

Do not place process state such as:

- medical status
- written-test status
- learner-permit status
- practical-test status

directly on `Customer`.

A customer may have multiple licence applications over time.

Example:

```text
Customer
 ├── Application #1: New licence
 └── Application #2: Add vehicle class
```

---

# 12. Application Status Philosophy

Keep overall application lifecycle states broad.

Examples:

- DRAFT
- ACTIVE
- ON_HOLD
- COMPLETED
- CANCELLED
- ABANDONED

Do not overload `LicenceApplication.status` with every workflow stage.

Detailed state belongs to the relevant domain records.

Example:

```text
Application.status = ACTIVE

Class A = COMPLETED
Class B = REATTEMPT_REQUIRED
Class B1 = TRAINING
```

This is preferable to one giant application-status enum.

---

# 13. Vehicle Classes

Requested driving categories belong to `ApplicationVehicleClass`.

Do not store categories as:

```ts
application.categories = 'A,B,B1'
```

Use relationships.

A licence application may contain multiple requested vehicle classes, and each class can have its own:

- training lifecycle
- practical-test lifecycle
- status
- completion result

Reference/master vehicle-class data should remain separate from application-specific data.

---

# 14. Applicant Snapshot

`Customer` is the current source of truth for customer profile information.

Historical licence applications may require the identity/address/contact details that were used at the time of application.

Use `ApplicantSnapshot` to preserve those values when required.

Example:

```text
Customer
= current information

ApplicantSnapshot
= information used for Application #123
```

Do not make historical applications silently change when the customer updates their profile.

---

# 15. Documents

Prefer a generic document model where practical.

Avoid unnecessary tables such as:

- NicDocument
- PassportDocument
- MedicalDocument

unless their business structures genuinely diverge.

Use concepts such as:

- Document
- DocumentType
- ApplicationDocument
- DocumentRequirement

Document requirements should be configuration/domain driven where possible.

Do not hardcode document checklists only in frontend components.

---

# 16. Medical Assessment

Medical assessment records belong to a licence application.

Do not store unnecessary clinical information.

The SaaS generally needs operational information such as:

- appointment/reference
- assessment date
- status
- fit/unfit/referred outcome
- certificate number
- issue date
- expiry date
- certificate document

Support multiple assessment records where history is required.

Example:

```text
Assessment #1 → REFERRED
Assessment #2 → PASSED
```

---

# 17. Written Tests and Reattempts

Separate the written-test aggregate from individual attempts.

Example:

```text
WrittenTest
 ├── Attempt 1 → FAILED
 ├── Attempt 2 → ABSENT
 └── Attempt 3 → PASSED
```

Never overwrite the current result in a way that destroys attempt history.

Attempt numbering and result history must be preserved.

---

# 18. Learner Permits

Learner permits belong to an application.

Support permit history when needed for:

- expiry
- replacement
- correction
- superseding permits

Do not assume exactly one immutable permit record forever.

---

# 19. Training Domain

Training should be modelled around:

```text
ApplicationVehicleClass
        ↓
TrainingPlan
        ↓
TrainingSession
```

Training sessions should reference appropriate:

- instructor
- vehicle
- schedule
- attendance
- lesson type
- status

Training for different vehicle classes must remain distinct.

Do not attach all training directly to `Customer`.

---

# 20. Instructor and Vehicle Rules

`Instructor` is a business-domain entity.

`TenantUser` is an authenticated SaaS user.

An instructor may optionally have an associated tenant-user account, but these are not the same concept.

Track instructor eligibility/qualification by vehicle class where required.

Vehicle records should support operational status such as:

- AVAILABLE
- IN_USE
- MAINTENANCE
- UNAVAILABLE
- RETIRED

Scheduling logic must prevent conflicting instructor or vehicle assignments.

---

# 21. Practical Tests and Reattempts

Practical tests belong to `ApplicationVehicleClass`.

Each test can contain multiple attempts.

Example:

```text
Class B
 ├── Attempt 1 → FAILED
 └── Attempt 2 → PASSED
```

A failed attempt does not create a new customer or licence application.

The same application remains active through reattempts.

---

# 22. Driving Licence

Separate the persistent licence from the transaction that issued or changed it.

Use concepts such as:

- DrivingLicence
- LicenceClass
- LicenceIssuance

Example:

```text
Application #1 → NEW_LICENCE → B
Application #2 → ADD_CLASS   → A
```

may result in one persistent driving licence containing:

```text
A
B
```

Do not create unrelated licence records when the domain represents one continuing licence.

---

# 23. Source of Truth

Avoid duplicating business information across entities.

Preferred ownership examples:

| Information | Source of Truth |
|---|---|
| Current customer profile | Customer |
| Application-time applicant details | ApplicantSnapshot |
| Requested classes | ApplicationVehicleClass |
| Medical result | MedicalAssessment |
| Written result | WrittenTestAttempt |
| Learner permit | LearnerPermit |
| Training sessions | TrainingSession |
| Practical result | PracticalTestAttempt |
| Current licence | DrivingLicence |
| Licensed classes | LicenceClass |
| Tenant money owed | TenantInvoice |
| Tenant money received | TenantPayment |
| Customer money owed | CustomerInvoice |
| Customer money received | CustomerPayment |

Reference data instead of copying it unless a historical snapshot is intentionally required.

---

# 24. Eligibility Rules

Business eligibility rules must be centralized.

Do not scatter regulatory checks throughout controllers, frontend code, or arbitrary services.

Examples:

```ts
eligibilityService.checkWrittenTestEligibility(applicationId)
eligibilityService.checkPracticalEligibility(applicationVehicleClassId)
```

Return structured blockers where possible.

Example:

```ts
{
  eligible: false,
  blockers: [
    {
      code: 'MINIMUM_WAITING_PERIOD',
      message: 'Required learner period has not been completed',
      eligibleFrom: '2026-12-05'
    }
  ]
}
```

Rules that may change over time should not be unnecessarily hardcoded into unrelated modules.

---

# 25. Workflow Design

Do not build a generic workflow/BPM engine unless explicitly required.

Prefer explicit domain entities:

- MedicalAssessment
- WrittenTest
- LearnerPermit
- TrainingPlan
- PracticalTest
- LicenceIssuance

Use domain services to coordinate transitions.

Keep configurable items configurable, but do not turn the system into an abstract workflow platform prematurely.

---

# 26. Controllers

Controllers should remain thin.

Controllers are responsible for:

- request parsing
- authentication/authorization integration
- DTO validation
- calling application/domain services
- mapping responses

Controllers should not contain:

- Prisma queries
- complex business rules
- transaction orchestration
- plan-limit calculations
- tenant-access calculations
- workflow decision logic

---

# 27. Services

Services coordinate use cases and enforce business rules.

Prefer explicit use-case methods such as:

```ts
createTenant()
changeTenantPlan()
recordTenantPayment()
createLicenceApplication()
scheduleWrittenTestAttempt()
recordPracticalTestResult()
```

Avoid overly generic methods such as:

```ts
updateAnything()
process()
handle()
saveData()
```

when a meaningful business name is available.

For substantial workflows, prefer transaction boundaries around the complete invariant-changing operation.

---

# 28. Prisma and Persistence

Prisma access should follow the repository's established data-access pattern.

Before introducing direct Prisma usage inside a new service, inspect existing modules and follow established conventions.

General rules:

- Do not query Prisma from controllers.
- Keep tenant filters mandatory for tenant-owned data.
- Use transactions for multi-write operations that must succeed atomically.
- Add indexes intentionally based on query patterns.
- Use database uniqueness constraints for true invariants.
- Avoid relying only on application-level duplicate checks.
- Use explicit relations.
- Avoid JSON blobs for strongly structured domain data unless flexibility is truly required.
- Avoid storing arrays of IDs when relational tables are appropriate.

---

# 29. Prisma Schema Changes

Before editing `schema.prisma`:

1. Understand the domain relationship.
2. Check existing naming conventions.
3. Decide ownership and cardinality.
4. Decide nullable vs required fields.
5. Decide deletion behaviour intentionally.
6. Identify required unique constraints.
7. Identify tenant-aware indexes.
8. Consider historical/audit requirements.
9. Generate a migration.
10. Review generated SQL before accepting it.

Do not make destructive migrations casually.

Never drop or rewrite production data without explicitly understanding the migration impact.

---

# 30. Database Constraints

Use database constraints for domain invariants when practical.

Examples might include:

- unique tenant code
- unique platform-admin email
- unique tenant-user email within the intended scope
- unique invoice number within intended scope
- unique application number within intended scope
- unique attempt number per test
- unique active/valid relationships where enforceable

Do not assume globally unique customer identifiers across tenants unless the business explicitly requires cross-tenant identity sharing.

Tenant isolation takes priority.

---

# 31. Transactions

Use Prisma transactions for operations such as:

## Tenant creation

Conceptually:

```text
Create Tenant
Create Tenant Contact
Create Subscription
Create Initial Access State
Create Initial Invoice if required
Create Audit Record
```

## Recording tenant payment

Conceptually:

```text
Create TenantPayment
Recalculate Invoice
Update Invoice Status
Reevaluate Tenant Access
Create Audit Record
```

## Licence workflows

Use transactions when multiple records form one business action and partial completion would violate invariants.

Do not keep database transactions open while waiting on external APIs, email delivery, or other network operations.

---

# 32. External Integrations

Treat external authorities and services behind adapters.

Examples may include:

- DMT
- NTMI
- SMS providers
- Email providers
- payment providers

Do not make core domain code depend directly on provider-specific SDK details.

Prefer interfaces/adapters where meaningful.

Do not assume government APIs exist unless integration availability has been verified.

Support manual/reference-based workflows where integration is unavailable.

---

# 33. DTOs and Validation

Use NestJS DTOs for API boundaries.

Validate:

- required fields
- enums
- formats
- ranges
- dates
- identifiers

Do not treat DTO validation as a replacement for domain validation.

Example:

DTO validation can ensure:

```text
vehicleClassId is a UUID
```

Domain validation must ensure:

```text
vehicleClassId is valid for this application and tenant
```

---

# 34. Errors

Use consistent domain/application errors.

Prefer machine-readable error codes.

Examples:

```text
TENANT_SUSPENDED
PLAN_LIMIT_REACHED
PLAN_FEATURE_NOT_AVAILABLE
CUSTOMER_NOT_FOUND
APPLICATION_NOT_FOUND
INVALID_APPLICATION_STATE
WRITTEN_TEST_NOT_ELIGIBLE
PRACTICAL_TEST_NOT_ELIGIBLE
INSTRUCTOR_UNAVAILABLE
VEHICLE_UNAVAILABLE
INVOICE_ALREADY_PAID
```

Do not expose raw Prisma/database errors directly to API consumers.

Map internal failures to appropriate application/HTTP errors.

---

# 35. Authorization

Every protected operation should consider the appropriate layers.

For tenant operations:

```text
Authentication
    ↓
Tenant resolution
    ↓
Tenant access
    ↓
Plan entitlement / usage limit where relevant
    ↓
Tenant RBAC permission
    ↓
Domain rules
```

For platform-admin operations:

```text
Platform authentication
    ↓
Platform permission
    ↓
Platform domain rules
```

Do not mix the two authorization models.

---

# 36. Audit and Business Events

Keep business events distinct from audit logs.

## Business event

Represents something meaningful that happened in the domain.

Examples:

- APPLICATION_CREATED
- MEDICAL_PASSED
- WRITTEN_TEST_FAILED
- LEARNER_PERMIT_ISSUED
- PRACTICAL_TEST_PASSED
- LICENCE_ISSUED
- TENANT_CREATED
- TENANT_SUSPENDED

## Audit log

Answers:

> Who changed what in the software?

Audit sensitive platform and operational actions.

Examples:

- admin changed tenant plan
- admin recorded invoice payment
- user changed practical-test result
- user verified customer document

---

# 37. Scheduling

Scheduling must account for resource conflicts.

Relevant resources may include:

- student/customer
- instructor
- vehicle
- branch/location

Before confirming a training session or similar booking, validate applicable availability and qualification constraints.

Keep calendar/scheduling concerns separate from business records.

For example:

```text
Appointment
= scheduling representation

PracticalTestAttempt
= examination business record
```

---

# 38. Notifications

Notifications should react to business events rather than being deeply embedded into unrelated domain logic.

Possible notification scenarios:

- invoice approaching due date
- invoice overdue
- grace period warning
- tenant suspended
- medical appointment reminder
- written-test reminder
- training-session reminder
- practical-test reminder
- learner-permit expiry warning
- licence issued

Prefer notification orchestration after successful business transactions.

---

# 39. Security

Treat the API as a multi-tenant production SaaS.

Always consider:

- tenant isolation
- authorization
- IDOR prevention
- input validation
- credential security
- password hashing
- token/session security
- rate limiting where appropriate
- secure file access
- least privilege
- auditability
- sensitive-data minimization

Never trust entity IDs from clients without verifying ownership and access.

Do not expose private customer documents through permanent public URLs.

---

# 40. Testing Expectations

Every meaningful feature should include appropriate tests.

Use the project's established testing stack and conventions.

Prefer coverage across:

## Unit tests

For:

- business rules
- eligibility logic
- calculations
- state transitions
- entitlement logic
- billing/access decisions

## Integration tests

For:

- Prisma repositories/data access
- transaction behaviour
- tenant isolation
- database constraints
- module interactions

## E2E tests

For critical workflows such as:

```text
Platform admin creates tenant
Tenant is assigned plan
Tenant owner logs in

Invoice becomes overdue
Grace expires
Tenant business access is blocked

Admin records payment
Tenant access is restored

Customer → Application → Written Test → Permit → Training → Practical Test → Licence
```

Do not write tests only to satisfy line coverage.

Test business behaviour and invariants.

---

# 41. High-Risk Changes

Treat the following as substantial/high-risk:

- authentication
- authorization
- tenant isolation
- billing
- tenant suspension/restoration
- Prisma migrations
- destructive schema changes
- licence workflow transitions
- payment handling
- file/document authorization
- plan-limit enforcement
- cross-module transaction changes

For these changes:

1. inspect surrounding architecture carefully
2. create/adjust tests
3. self-review
4. use an independent review subagent when available
5. run relevant verification before completion

---

# 42. Self-Review Checklist

Before reporting completion, review:

## Architecture

- Is the change in the correct module?
- Did I preserve modular-monolith boundaries?
- Did I accidentally create unnecessary coupling?
- Did I duplicate an existing abstraction?

## Tenant safety

- Is every tenant-owned query correctly scoped?
- Can an ID from another tenant be used to access data?
- Did I trust a client-supplied tenantId?

## Authorization

- Is authentication required?
- Is tenant access checked?
- Are plan limits/features checked where necessary?
- Is user permission checked?

## Domain

- Is the aggregate owner correct?
- Are invariants enforced?
- Is history preserved where needed?
- Did I overwrite attempt/history data?
- Am I duplicating a source-of-truth field?

## Persistence

- Are relations correct?
- Are indexes needed?
- Are uniqueness constraints correct?
- Is a transaction required?
- Is the migration safe?

## API

- Are DTOs validated?
- Are errors consistent?
- Are response models appropriate?
- Is internal information being leaked?

## Tests

- Did I test the success path?
- Did I test important failure paths?
- Did I test authorization/tenant boundaries?
- Did I test edge cases and state transitions?

---

# 43. Verification

Before reporting completion, run the relevant project commands.

Depending on repository scripts, this usually includes some combination of:

```bash
npm run lint
npm run test
npm run test:e2e
npm run build
npx prisma validate
npx prisma generate
```

If a Prisma migration was added, also verify the migration workflow used by this repository.

Do not claim a command passed unless it was actually run successfully.

If verification cannot be run, clearly report what was not verified and why.

---

# 44. Implementation Principles

Prefer:

- clear domain names
- explicit business methods
- small focused modules
- composition
- dependency inversion at external boundaries
- database-backed invariants
- transaction-safe workflows
- immutable history where important
- configuration over scattered conditionals
- boring, maintainable architecture

Avoid:

- giant generic services
- god modules
- microservices without need
- generic workflow engines without need
- business logic in controllers
- Prisma calls in controllers
- plan-specific conditionals scattered across modules
- duplicated tenantId trust
- destructive state overwrites
- excessive JSON columns
- speculative abstractions
- premature event-driven complexity

---

# 45. Decision Rule

When unsure, prefer the design that:

1. preserves tenant isolation,
2. keeps the source of truth clear,
3. protects historical records,
4. expresses the business domain explicitly,
5. keeps platform concerns separate from tenant business concerns,
6. minimizes unnecessary infrastructure,
7. is easy to test,
8. can evolve without rewriting the entire monolith.

---

# 46. Completion Report

When finishing a task, report concisely:

1. what was implemented,
2. important architectural/domain decisions,
3. files/modules changed,
4. Prisma/migration changes,
5. tests added or updated,
6. verification commands run,
7. any known follow-up or unresolved risk.

Do not report a feature as complete while known required verification is still failing.
