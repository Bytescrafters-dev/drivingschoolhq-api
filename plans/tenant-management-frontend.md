# Frontend plan — Platform Admin: Tenant Management

Audience: frontend agent building the **platform admin dashboard** (Next.js app `drivingschoolhq-admin`).
This document is the contract for onboarding and managing driving schools (tenants): the tenant
profile, its subscription, its owner account, closing/reopening, and its audit history.

It builds on `plans/plan-price-frontend.md` (plan catalogue, auth, money format, error shape).
Everything here reflects the backend on branch `feat/tenancy-plans-subscriptions-auth`
(`src/platform/tenants/`, `src/platform/subscriptions/`).

---

## 1. Concepts and how they relate

```text
PricePlan ─┬─ PlanPrice ◄──────────────┐   (catalogue: plan-price-frontend.md)
           └─ limits / features        │ planPriceId
                                       │
Tenant (driving school, DS code)       │
 ├── TenantAccess        1   ACTIVE | GRACE_PERIOD | SUSPENDED   (can the school use the SaaS?)
 ├── TenantSubscription  n   history; at most 1 ACTIVE + 1 SCHEDULED at any time
 │      └── snapshot of plan/price/agreed amount/grace days, so it never changes when the catalogue changes
 └── TenantUser (OWNER)  1   the school's owner account; logs in to the tenant app
        (other staff users come later and are managed by the school itself, not here)
```

| Concept | Meaning | Key rules |
|---|---|---|
| **Tenant** | A driving school. Identified by its government **DS code** (e.g. `DS119`). | `status` is `ACTIVE` or `CLOSED`. Never deleted. Closed tenants are read-only until reopened. |
| **TenantAccess** | Whether the school may use the system (billing/suspension). | Created `ACTIVE` with the tenant. Separate from the tenant status and the owner's status. There are **no endpoints to change it yet** (suspension comes with billing). Display it read-only. |
| **TenantSubscription** | The commercial agreement: which plan price, agreed amount, trial, grace period. | Always created **together with the tenant** (a tenant can't exist without one). History is kept: rows become `ENDED` / `CANCELLED`, they are never edited. Plan changes are **scheduled for the next renewal date**, never immediate. |
| **Owner** | The school's first and only `OWNER` user (`TenantUser` with role `OWNER`). | Created **together with the tenant**, with a temporary password chosen by the admin. On first login to the tenant app the owner must change it. Exactly one owner per tenant. Platform admins can edit, reset the password, disable or enable the owner. |

### Dependencies

1. **A tenant needs an active plan price.** Creating a tenant requires a `planPriceId` that belongs to
   an **ACTIVE plan** and is itself an **ACTIVE price**. If the catalogue has no active plan, show
   an empty state with a link to the Plans screen.
2. **Tenant, access, subscription and owner are created in one request** (`POST /platform/tenants`),
   atomically: either everything is created or nothing is. There is no "draft tenant" or "add the
   owner later" step.
3. **Plan changes depend on the catalogue too:** scheduling a change also needs an active price of an
   active plan.
4. **Closed tenants block** profile edits, subscription changes, grace-period changes and owner
   management (`409 TENANT_CLOSED`). Only **Reopen** (with new subscription terms) works.
5. **Closing a tenant** ends the active subscription today, cancels any scheduled change, and signs
   out every tenant user immediately. Users and data are kept.
6. **Owner actions affect live sessions:** resetting the password, disabling the owner, or changing the
   owner's email signs the owner out everywhere immediately.
7. **The DS code is the school's login key.** Tenant users sign in with `dsCode + email + password`.
   Changing a tenant's DS code changes what its users must type at login, so warn before saving.

### Enums (fixed, hard-code them in the UI)

| Enum | Values |
|---|---|
| `TenantStatus` | `ACTIVE`, `CLOSED` |
| `TenantAccessStatus` | `ACTIVE`, `GRACE_PERIOD`, `SUSPENDED` |
| `TenantSubscriptionStatus` | `SCHEDULED` (change waiting for renewal), `ACTIVE` (current), `ENDED` (replaced/ended), `CANCELLED` (withdrawn) |
| `BillingPeriod` | `MONTHLY`, `QUARTERLY`, `ANNUAL` |
| `TenantUserStatus` | `ACTIVE`, `DISABLED` |
| `TenantRole` | `OWNER`, `ADMIN`, `BRANCH_MANAGER`, `FRONT_DESK`, `INSTRUCTOR`, `ACCOUNTANT` (only `OWNER` appears in these screens) |
| `District` (25) | `AMPARA`, `ANURADHAPURA`, `BADULLA`, `BATTICALOA`, `COLOMBO`, `GALLE`, `GAMPAHA`, `HAMBANTOTA`, `JAFFNA`, `KALUTARA`, `KANDY`, `KEGALLE`, `KILINOCHCHI`, `KURUNEGALA`, `MANNAR`, `MATALE`, `MATARA`, `MONARAGALA`, `MULLAITIVU`, `NUWARA_ELIYA`, `POLONNARUWA`, `PUTTALAM`, `RATNAPURA`, `TRINCOMALEE`, `VAVUNIYA` (label: title case, `NUWARA_ELIYA` → "Nuwara Eliya") |

---

## 2. Subscription timeline (what the dates mean)

All subscription dates are calendar dates `"YYYY-MM-DD"` in **Asia/Colombo**. Display them as they
are, with no timezone conversion. (`createdAt`, `cancelledAt` and similar timestamps are ISO
date-times; convert those normally.)

```text
startDate = today (no backdating)
   │
   │ optional trial: startDate … trialEndDate (inclusive)
   ▼
paid periods start the day after trialEndDate (or on startDate if no trial)
   │ period 1 │ period 2 │ ...      each 1 / 3 / 12 months; month-end clamped (31 Jan → 28 Feb)
   ▼
nextRenewalDate = end of the current period (exclusive) = the start of the next one
                  (while in trial: the first paid day)
```

The ACTIVE subscription in responses carries `inTrial`, `currentPeriodStart`, `currentPeriodEnd`
(exclusive; null while in trial) and `nextRenewalDate`. Display `currentPeriodEnd` as
"until {day before}" or show "Renews on {nextRenewalDate}".

**Plan change flow:**

```text
POST scheduled-change ─► SCHEDULED row (startDate = nextRenewalDate)
                              │  (a new scheduled change replaces it: the old one becomes CANCELLED)
                              │  (POST scheduled-change/cancel withdraws it: CANCELLED)
       renewal job, daily 00:05 Asia/Colombo, on/after startDate
                              ▼
old ACTIVE ─► ENDED (endDate = day before)      SCHEDULED ─► ACTIVE
```

There is no proration and no immediate plan switch. The change happens on the renewal date.

**Commercial terms**, snapshotted on each subscription:

- `listAmount`: the plan price at the time (copied from the catalogue).
- `agreedAmount`: what this school pays. Defaults to `listAmount`. It may be **lower** (a discount,
  which then requires a `discountReason`) but **never higher** than the list price.
- `gracePeriodDays`: 0–90, default **7**. Days of grace after an invoice is overdue before access is
  suspended (invoicing comes later; the value is stored now).

---

## 3. Endpoints

All endpoints need `Authorization: Bearer <platform access token>`. Error shape:
`{ statusCode, code, message }`. Money values are LKR decimal strings (`"5000.00"`). Unknown body
fields are rejected (`400`), so send only the documented fields.

### Permissions (from `GET /platform/auth/me` → `permissions`)

| Permission | SUPER_ADMIN | OPERATIONS_ADMIN | BILLING_ADMIN | SUPPORT |
|---|---|---|---|---|
| `TENANTS_READ` (list/view tenant, view owner) | ✅ | ✅ | ✅ | ✅ |
| `TENANTS_MANAGE` (edit tenant, manage owner) | ✅ | ✅ | ❌ | ❌ |
| `SUBSCRIPTIONS_READ` (view subscription/history) | ✅ | ✅ | ✅ | ✅ |
| `SUBSCRIPTIONS_MANAGE` (schedule/cancel change, grace) | ✅ | ✅ | ❌ | ❌ |
| `PLANS_READ` (pick a plan price) | ✅ | ✅ | ✅ | ✅ |
| `PLATFORM_AUDIT_READ` (audit history) | ✅ | ❌ | ❌ | ❌ |

**Create, close and reopen need both** `TENANTS_MANAGE` **and** `SUBSCRIPTIONS_MANAGE`. Hide or
disable actions the admin can't perform. The backend enforces this with
`403 PLATFORM_PERMISSION_DENIED`.

### Shared field rules (create and edit forms)

| Field | Rule | Backend normalisation |
|---|---|---|
| `dsCode` | `DS` + 1–10 digits, e.g. `DS119` (case-insensitive input) | trimmed and uppercased; unique → `409 TENANT_DS_CODE_TAKEN` |
| `name` | 1–200 chars (legal/registered name) | trimmed |
| `displayName` | 1–100 chars (shown in the app) | trimmed |
| `address` | 1–500 chars, free text | trimmed |
| `district` | `District` enum | — |
| `phone` (tenant and owner) | Sri Lankan number: `0771234567`, `771234567`, `+94771234567`, `0112345678` | stored as `+94XXXXXXXXX`; display as returned |
| owner `email` | valid email, ≤ 254 | stored lowercase; unique **within the tenant** (`409 TENANT_USER_EMAIL_TAKEN`) |
| owner `nic` | old `123456789V` / `X`, or new 12 digits | uppercased; unique within the tenant (`409 TENANT_USER_NIC_TAKEN`) |
| owner `fullName` | 1–200 chars | trimmed |
| `temporaryPassword` | 12–128 chars | never returned; hand it to the owner out-of-band |
| `planPriceId` | UUID of an ACTIVE price of an ACTIVE plan | `404 PLAN_PRICE_NOT_FOUND`, `409 PLAN_NOT_SUBSCRIBABLE` |
| `trialEndDate` | optional `YYYY-MM-DD`, ≥ today (Asia/Colombo); omit or `null` for no trial | `400 INVALID_TRIAL_END_DATE` |
| `agreedAmount` | optional LKR string ≤ list price | `400 AGREED_AMOUNT_EXCEEDS_LIST_PRICE` |
| `discountReason` | ≤ 500 chars; **required when** `agreedAmount ≠ listAmount` | `400 DISCOUNT_REASON_REQUIRED` |
| `gracePeriodDays` | optional int 0–90 (default 7) | `400 INVALID_GRACE_PERIOD` |

### Response shapes

```ts
type TenantResponse = {
  id: string; dsCode: string; name: string; displayName: string;
  address: string; district: District; phone: string;      // "+94771234567"
  status: 'ACTIVE' | 'CLOSED'; closedAt: string | null;
  createdById: string; createdAt: string; updatedAt: string;
};

type TenantListItemResponse = TenantResponse & {
  accessStatus: TenantAccessStatus | null;
  currentPlan: { planName: string; billingPeriod: BillingPeriod } | null;  // null when closed
};

type TenantSubscriptionResponse = {
  id: string; planId: string; planPriceId: string; planCode: string; planName: string;
  billingPeriod: BillingPeriod;
  listAmount: string; agreedAmount: string; discountReason: string | null;
  gracePeriodDays: number;
  status: 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
  startDate: string; trialEndDate: string | null; endDate: string | null;   // "YYYY-MM-DD"
  cancelledAt: string | null; cancellationReason: string | null;
  createdById: string; createdAt: string;
};

type ActiveSubscriptionResponse = TenantSubscriptionResponse & {
  inTrial: boolean;
  currentPeriodStart: string | null;   // null while in trial
  currentPeriodEnd: string | null;     // exclusive; null while in trial
  nextRenewalDate: string;
};

type TenantOwnerResponse = {
  id: string; email: string; fullName: string; phone: string | null; nic: string | null;
  role: 'OWNER'; status: 'ACTIVE' | 'DISABLED';
  mustChangePassword: boolean;          // true until the owner replaces the temporary password
  passwordChangedAt: string | null; lastLoginAt: string | null; disabledAt: string | null;
  createdAt: string; updatedAt: string;
};

type TenantDetailsResponse = TenantResponse & {
  access: { status: TenantAccessStatus; statusChangedAt: string } | null;
  subscription: ActiveSubscriptionResponse | null;        // null when closed
  scheduledSubscription: TenantSubscriptionResponse | null;
  owner: TenantOwnerResponse | null;
};

type TenantSubscriptionsViewResponse = {
  subscription: ActiveSubscriptionResponse | null;
  scheduledSubscription: TenantSubscriptionResponse | null;
};
```

Tenant-level write endpoints return the full `TenantDetailsResponse`; subscription endpoints return
`TenantSubscriptionsViewResponse`; owner endpoints return `TenantOwnerResponse`. Update your cache from
the response.

---

### 3.1 Tenants

#### List tenants

`GET /platform/tenants?status=&district=&accessStatus=&search=&page=1&pageSize=20` · `TENANTS_READ`

- `status`: `ACTIVE|CLOSED`. `district`: `District`. `accessStatus`: `ACTIVE|GRACE_PERIOD|SUSPENDED`.
- `search`: matches DS code, name or display name (case-insensitive, ≤ 100 chars).
- `page` ≥ 1, `pageSize` 1–100. Sorted newest first.

→ `{ items: TenantListItemResponse[], total, page, pageSize }`

#### Get tenant

`GET /platform/tenants/:id` · `TENANTS_READ` → `TenantDetailsResponse` · `404 TENANT_NOT_FOUND`

This single call feeds the whole detail page header plus the subscription and owner cards.

#### Create tenant (onboarding)

`POST /platform/tenants` · `TENANTS_MANAGE` + `SUBSCRIPTIONS_MANAGE` → `201 TenantDetailsResponse`

```json
{
  "tenant": {
    "dsCode": "DS119",
    "name": "Lanka Driving School (Pvt) Ltd",
    "displayName": "Lanka Driving School",
    "address": "12 Galle Road, Colombo 03",
    "district": "COLOMBO",
    "phone": "0112345678"
  },
  "subscription": {
    "planPriceId": "6f1c…",
    "trialEndDate": "2026-11-19",
    "agreedAmount": "6000.00",
    "discountReason": "Launch partner discount",
    "gracePeriodDays": 7
  },
  "owner": {
    "fullName": "Nimal Perera",
    "email": "nimal@lankadriving.lk",
    "phone": "0771234567",
    "nic": "199012345678",
    "temporaryPassword": "Welcome-To-DSHQ-2026"
  }
}
```

Only `subscription.planPriceId` is required inside `subscription`. All other subscription fields are
optional (no trial, list price, 7 days of grace).

Possible errors: `409 TENANT_DS_CODE_TAKEN`, `404 PLAN_PRICE_NOT_FOUND`,
`409 PLAN_NOT_SUBSCRIBABLE`, `400 INVALID_TRIAL_END_DATE`, `400 AGREED_AMOUNT_EXCEEDS_LIST_PRICE`,
`400 DISCOUNT_REASON_REQUIRED`, `400 INVALID_GRACE_PERIOD`, `400 BAD_REQUEST` (validation;
nested messages look like `tenant.dsCode must be …`, so map them to fields by prefix).

After success, show the owner's login details once ("DS code `DS119`, email …, temporary password …,
the password must be changed at first login"), with a copy button. The backend never returns the
password again.

#### Update tenant profile

`PATCH /platform/tenants/:id` · `TENANTS_MANAGE` → `TenantDetailsResponse`

Body: any subset of `{ dsCode, name, displayName, address, district, phone }`. Identical values are a
no-op. Errors: `409 TENANT_CLOSED`, `409 TENANT_DS_CODE_TAKEN`, `404 TENANT_NOT_FOUND`.

#### Close tenant

`POST /platform/tenants/:id/close` · `TENANTS_MANAGE` + `SUBSCRIPTIONS_MANAGE` → `TenantDetailsResponse`

Body `{ "reason": "Contract terminated" }` (1–500 chars, required). Errors:
`409 TENANT_ALREADY_CLOSED`, `400 REASON_REQUIRED`.

Use a destructive confirm that explains the effects: the subscription ends today, any scheduled
change is cancelled, all school users are signed out and can't log in, and data is kept (the tenant
can be reopened).

#### Reopen tenant

`POST /platform/tenants/:id/reopen` · `TENANTS_MANAGE` + `SUBSCRIPTIONS_MANAGE` → `TenantDetailsResponse`

Body = **subscription terms** (same as `subscription` in create):
`{ planPriceId, trialEndDate?, agreedAmount?, discountReason?, gracePeriodDays? }`.

This starts a new ACTIVE subscription today and sets access back to ACTIVE. Errors:
`409 TENANT_NOT_CLOSED`, plus the subscription-term errors above. The owner account is unchanged
(it's not disabled by closing), so the owner can log in again with their existing password.

---

### 3.2 Subscription

Base: `/platform/tenants/:tenantId`

| Action | Request | Permission | Response |
|---|---|---|---|
| Current + scheduled | `GET /subscription` | `SUBSCRIPTIONS_READ` | `TenantSubscriptionsViewResponse` |
| Full history | `GET /subscriptions` | `SUBSCRIPTIONS_READ` | `{ items: TenantSubscriptionResponse[] }`, newest first, all statuses |
| Schedule plan change | `POST /subscription/scheduled-change` | `SUBSCRIPTIONS_MANAGE` | `TenantSubscriptionsViewResponse` (200) |
| Cancel scheduled change | `POST /subscription/scheduled-change/cancel` | `SUBSCRIPTIONS_MANAGE` | `TenantSubscriptionsViewResponse` (200) |
| Change grace period | `PATCH /subscription/grace-period` | `SUBSCRIPTIONS_MANAGE` | `TenantSubscriptionsViewResponse` |

**Schedule plan change** body:

```json
{ "planPriceId": "…", "agreedAmount": "7000.00", "discountReason": "Renewal discount", "gracePeriodDays": 7 }
```

- `planPriceId` is required. The others are optional: `agreedAmount` defaults to the new list price,
  and `gracePeriodDays` defaults to the **current** subscription's value. No `trialEndDate` here.
- It starts on the current `nextRenewalDate` (trial end + 1 when in trial). Show this date in the
  confirm dialog: "Takes effect on {nextRenewalDate}".
- If a scheduled change already exists, it is **replaced** (the old one becomes CANCELLED). Warn about
  this when `scheduledSubscription` isn't null.
- The same plan price with the same agreed amount and grace period → `409 SUBSCRIPTION_CHANGE_NO_OP`.
  Use the same price with a different agreed amount to re-negotiate the price at renewal.
- Errors: `409 NO_ACTIVE_SUBSCRIPTION`, `409 TENANT_CLOSED`, `404 PLAN_PRICE_NOT_FOUND`,
  `409 PLAN_NOT_SUBSCRIBABLE`, and the discount and grace errors.

**Cancel scheduled change** body `{ "reason": "Customer changed their mind" }` (1–500, required).
Errors: `404 NO_SCHEDULED_CHANGE`, `409 TENANT_CLOSED`.

**Change grace period** body `{ "gracePeriodDays": 14 }` (0–90). It applies to the current ACTIVE
subscription immediately; the same value is a no-op. Errors: `409 NO_ACTIVE_SUBSCRIPTION`,
`409 TENANT_CLOSED`, `400 INVALID_GRACE_PERIOD`.

`404 TENANT_NOT_FOUND` applies to all of these.

---

### 3.3 Owner

Base: `/platform/tenants/:tenantId/owner`

| Action | Request | Permission | Effect |
|---|---|---|---|
| View | `GET /` | `TENANTS_READ` | — |
| Edit | `PATCH /` body: any of `{ fullName, email, phone, nic }` | `TENANTS_MANAGE` | Changing the email signs the owner out |
| Reset password | `POST /reset-password` body `{ "temporaryPassword": "…" }` (12–128) | `TENANTS_MANAGE` | Sets `mustChangePassword = true` and signs the owner out |
| Disable | `POST /disable` (no body) | `TENANTS_MANAGE` | Owner can't log in and is signed out |
| Enable | `POST /enable` (no body) | `TENANTS_MANAGE` | Owner can log in again |

All return `TenantOwnerResponse` (200). Errors: `404 TENANT_NOT_FOUND`, `404 TENANT_OWNER_NOT_FOUND`,
`409 TENANT_CLOSED` (all writes), `409 TENANT_USER_EMAIL_TAKEN`, `409 TENANT_USER_NIC_TAKEN`,
`409 OWNER_ALREADY_DISABLED`, `409 OWNER_ALREADY_ACTIVE`.

After a password reset, show the new temporary password once, with a copy button (same as onboarding).

The tenant detail response already includes `owner`, so a separate `GET /owner` is only needed to
refresh that card.

---

### 3.4 Audit history (tenant "Activity" tab, SUPER_ADMIN only)

`GET /platform/audit-logs?tenantId={tenantId}&targetType=&action=&from=&to=&limit=50&cursor=` ·
`PLATFORM_AUDIT_READ` → `{ items: AuditEntry[], nextCursor: string | null }`

- `tenantId` (UUID) returns **every** entry about that tenant: its profile, its subscriptions and its
  owner. The backend guarantees that every tenant-related entry carries `tenantId`.
- Combine it with `targetType` (`TENANT`, `TENANT_SUBSCRIPTION`, `TENANT_USER`), `action`, and
  `from`/`to` (ISO date-times) to narrow the results.
- Results are newest first. For "Load more", pass `nextCursor` back as `cursor`; `null` means there
  are no more entries. `limit` is 1–100 (default 50).
- A non-UUID `tenantId` returns `400 BAD_REQUEST`.

```ts
type AuditEntry = {
  id: string;
  actorAdminId: string | null;     // null = system action (renewal job) or unauthenticated
  action: string;                  // e.g. TENANT_CREATED, SUBSCRIPTION_CHANGE_SCHEDULED
  targetType: string | null;       // TENANT | TENANT_SUBSCRIPTION | TENANT_USER | ...
  targetId: string | null;         // id of the tenant / subscription / owner
  tenantId: string | null;
  metadata: unknown;               // context, e.g. { field: { from, to } } diffs
  ipAddress: string | null; userAgent: string | null;
  createdAt: string;
};
```

Tenant-related actions:

| targetType | actions |
|---|---|
| `TENANT` | `TENANT_CREATED`, `TENANT_UPDATED`, `TENANT_CLOSED`, `TENANT_REOPENED` |
| `TENANT_SUBSCRIPTION` | `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_CHANGE_SCHEDULED`, `SUBSCRIPTION_CANCELLED`, `SUBSCRIPTION_ACTIVATED`, `SUBSCRIPTION_ENDED`, `SUBSCRIPTION_GRACE_PERIOD_CHANGED` |
| `TENANT_USER` | `TENANT_OWNER_CREATED`, `TENANT_OWNER_UPDATED`, `TENANT_OWNER_PASSWORD_RESET`, `TENANT_OWNER_DISABLED`, `TENANT_OWNER_ENABLED` |

Render it as a timeline: an action label, "by {admin}" (or "System"), the time, and an expandable
`metadata` view. In updates, `metadata` holds `{ field: { from, to } }`; NIC changes appear only as
`"changed"`. Passwords are never logged. `actorAdminId` can be resolved to a name via the admins list
(`GET /platform/admins`) if needed.

---

## 4. Screens to build

1. **Tenants list** (`/tenants`)
   - Columns: DS code, display name, district, phone, status badge, access badge, current plan
     ("Professional · Monthly"), created date.
   - Filters: status, district, access status, search; server-side pagination.
   - "Onboard school" button (needs `TENANTS_MANAGE` + `SUBSCRIPTIONS_MANAGE`).

2. **Onboard school wizard** (`/tenants/new`), one `POST` at the end:
   1. *School*: DS code, name, display name, address, district, phone.
   2. *Plan*: load `GET /platform/plans?status=ACTIVE&pageSize=100`, then `GET /platform/plans/:id`
      for each to get its active prices (the list doesn't include prices). Show plan cards with
      limits/features and a price selector per billing period, which yields the `planPriceId`.
      Then the optional trial end date (date picker, min = today), agreed amount (pre-filled with the
      list price; show a required "Discount reason" field when it differs; block amounts above the
      list price), and grace days (default 7).
   3. *Owner*: full name, email, phone, NIC, temporary password (with a "Generate" button, ≥ 12
      chars).
   4. *Review & create*, then the success screen showing the owner's login details once.

3. **Tenant detail** (`/tenants/:id`), loaded from `GET /platform/tenants/:id`:
   - **Header**: display name, DS code, status and access badges; actions Edit, Close / Reopen.
     Show a "Closed on {closedAt}" banner and disable all edit actions when CLOSED.
   - **Profile card**: fields plus an Edit dialog (`PATCH`). Show the DS-code login warning.
   - **Subscription card**: plan name and code, billing period, agreed vs list amount (show the
     discount reason if any), grace days, start date, trial badge until `trialEndDate`,
     current period and "Renews on {nextRenewalDate}".
     - Actions: "Change plan" (scheduled-change dialog with the same plan/price picker as the
       wizard, no trial), "Edit grace period".
     - When `scheduledSubscription` exists, show a "Scheduled change" panel: new plan, amount,
       "Starts {startDate}", and a "Cancel change" button that asks for a reason.
   - **Subscription history tab**: `GET /subscriptions` table with status badges, start/end dates,
     amounts and cancellation reasons.
   - **Owner card**: name, email, phone, NIC, status badge, "Must change password" badge, last login.
     Actions: Edit, Reset password, Disable / Enable.
   - **Activity tab** (SUPER_ADMIN only): `GET /platform/audit-logs?tenantId=…` timeline, see §3.4.

4. **Reopen dialog**: the same plan/price/trial/discount/grace picker as the wizard's step 2, posting
   to `/reopen`.

5. Shared: a `PlanPricePicker` component (wizard, change plan, reopen), LKR formatting, a
   Sri Lankan phone input hint, a calendar-date helper (no TZ shift for `YYYY-MM-DD`), permission
   gating, and error-code → field/toast mapping (§5).

---

## 5. Error handling summary

| HTTP | code | UI handling |
|---|---|---|
| 400 | `BAD_REQUEST` | field errors from `message` (`; `-separated; nested paths like `owner.email …`) |
| 400 | `INVALID_TRIAL_END_DATE`, `AGREED_AMOUNT_EXCEEDS_LIST_PRICE`, `DISCOUNT_REASON_REQUIRED`, `INVALID_GRACE_PERIOD`, `REASON_REQUIRED`, `INVALID_DS_CODE`, `INVALID_PHONE`, `INVALID_NIC`, `INVALID_AMOUNT` | field error on the matching input |
| 401 | `AUTHENTICATION_REQUIRED`, `INVALID_ACCESS_TOKEN`, `SESSION_INVALID` | refresh once, then go to login |
| 403 | `PASSWORD_CHANGE_REQUIRED` | redirect to change-password |
| 403 | `PLATFORM_PERMISSION_DENIED` | "You don't have permission" |
| 404 | `TENANT_NOT_FOUND`, `TENANT_OWNER_NOT_FOUND`, `PLAN_PRICE_NOT_FOUND`, `NO_SCHEDULED_CHANGE` | not-found state or toast, then refetch |
| 409 | `TENANT_DS_CODE_TAKEN` | field error on DS code |
| 409 | `TENANT_USER_EMAIL_TAKEN`, `TENANT_USER_NIC_TAKEN` | field error on owner email / NIC |
| 409 | `PLAN_NOT_SUBSCRIBABLE` | "This plan/price is no longer available"; reload the picker |
| 409 | `TENANT_CLOSED`, `TENANT_ALREADY_CLOSED`, `TENANT_NOT_CLOSED`, `NO_ACTIVE_SUBSCRIPTION`, `SUBSCRIPTION_CHANGE_NO_OP`, `OWNER_ALREADY_DISABLED`, `OWNER_ALREADY_ACTIVE` | toast with `message`, then refetch the tenant |

---

## 6. Not available yet (don't build UI for these)

- Changing **tenant access** (suspend/restore), invoices and payments: they come with SaaS billing.
- **Usage** against plan limits (staff/branches/instructors/vehicles counts).
- **Tenant-specific limit overrides.**
- **Owner transfer** or a second owner.
- Managing tenant **staff users**: that is done by the school itself in the tenant app.
- Immediate plan switch or proration: only scheduled changes exist.

## 7. Backend notes

- CORS allows the origins in the backend env `CORS_ORIGINS` (local: `http://localhost:3000`; the API
  runs on `http://localhost:8001`). Bearer tokens only, no cookies.
- No global route prefix. Paths are exactly as written.
