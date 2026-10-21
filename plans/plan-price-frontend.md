# Frontend plan — Platform Admin: Price Plans, Prices, Limits & Features

Audience: frontend agent building the **platform admin dashboard** (the SaaS operator's console, not
the driving-school app). This document is the contract for the "Plans catalogue" screens. Everything
here reflects the backend as implemented on branch `feat/tenancy-plans-subscriptions-auth`
(`src/platform/plans/`).

---

## 1. What these things are and how they relate

```text
PricePlan  (the product, e.g. STARTER / PROFESSIONAL)
 ├── PlanPrice   0..n   — what it costs per billing period (MONTHLY / QUARTERLY / ANNUAL)
 ├── PlanLimit   0..4   — numeric caps (staff users, branches, instructors, vehicles)
 └── PlanFeature 0..4   — on/off entitlements (multi-branch, SMS, reporting, API)

TenantSubscription ──► PlanPrice (a tenant subscribes to a specific *price*, not to a plan)
```

| Concept | Meaning | Key rules |
|---|---|---|
| **PricePlan** | Catalogue product. Has `code` (unique, uppercased, immutable after create), `name`, `description`, `isPublic`, `sortOrder`, `status`. | Lifecycle `DRAFT → ACTIVE ⇄ ARCHIVED` (see §3). Never hard-deleted once it has been active. |
| **PlanPrice** | Amount in **LKR** for one billing period. | At most **one ACTIVE price per billing period** per plan. Prices are **immutable**: "changing" a price archives the old one and creates a new one (new `id`). Archived prices stay forever, because existing subscriptions point at them. |
| **PlanLimit** | `{ code, value }`. `value: null` = **unlimited**, otherwise integer `0 … 1,000,000`. | Always set as a **complete set**: every limit code exactly once. Changes apply **immediately** to every tenant on that plan. |
| **PlanFeature** | A feature code the plan includes. Presence = enabled. | Set as a whole list (replace). Changes apply **immediately** to every tenant on that plan. |

Dependencies:

- Prices, limits and features **cannot exist without a plan**. They are always addressed under
  `/platform/plans/:id/...`.
- A plan **cannot be activated** until it has **≥ 1 active price** and **all 4 limits** defined.
  Features are optional (an empty list is valid).
- Tenants can only be subscribed to an **ACTIVE price of an ACTIVE plan**. The tenant-onboarding
  screen needs a `planPriceId` from this catalogue. (Private plans, `isPublic: false`, are still
  subscribable; `isPublic` only controls whether a plan is publicly advertised.)
- An ACTIVE plan must always keep **≥ 1 active price**. The backend refuses to archive the last one.

### Enum values (fixed, hard-code them in the UI)

| Enum | Values | Suggested label |
|---|---|---|
| `PricePlanStatus` | `DRAFT`, `ACTIVE`, `ARCHIVED` | Draft / Active / Archived |
| `PlanPriceStatus` | `ACTIVE`, `ARCHIVED` | Current / Archived |
| `BillingPeriod` | `MONTHLY`, `QUARTERLY`, `ANNUAL` | Monthly / Quarterly (3 months) / Annual |
| `PlanLimitCode` | `MAX_STAFF_USERS`, `MAX_BRANCHES`, `MAX_INSTRUCTORS`, `MAX_VEHICLES` | Staff users / Branches / Instructors / Vehicles |
| `PlanFeatureCode` | `MULTI_BRANCH`, `SMS_NOTIFICATIONS`, `ADVANCED_REPORTING`, `API_ACCESS` | Multi-branch / SMS notifications / Advanced reporting / API access |

---

## 2. Order of creation

Recommended flow: a **wizard** that sends **one** request at the end, followed by a separate
**Activate** step.

```text
Step 1  Plan details      code, name, description, isPublic, sortOrder
Step 2  Prices            0–3 rows, one per billing period (at least one needed to activate)
Step 3  Limits            all 4 codes, each a number or "Unlimited" (all 4 needed to activate)
Step 4  Features          checkboxes (optional)
        ─────────────────
        POST /platform/plans        → plan created as DRAFT (atomic, all or nothing)
Step 5  Review → "Activate"  POST /platform/plans/:id/activate   → ACTIVE (subscribable)
```

Alternative: create a bare draft with only `code` and `name`, then fill prices, limits and features
from the plan detail page using the `PUT` endpoints in §4. Either way, **activation is a separate
explicit action** and only works once prices and limits are complete.

Client-side "ready to activate" check (mirror of the backend rule; the backend re-checks):

```ts
const canActivate =
  plan.status !== 'ACTIVE' &&
  plan.prices.length > 0 &&                        // plan.prices only contains ACTIVE prices
  ALL_LIMIT_CODES.every(c => plan.limits.some(l => l.code === c));
```

Show the blockers when it is false ("Add at least one price", "Missing limits: …").

---

## 3. Plan lifecycle & which actions to show

```text
           activate                archive
 DRAFT ───────────────► ACTIVE ───────────────► ARCHIVED
   │                      ▲                        │
   │ delete               └──────── activate ──────┘   (re-activation allowed)
   ▼                                                    
 (gone)          DRAFT ── archive ──► ARCHIVED also allowed
```

| Status | Edit details | Prices / limits / features | Activate | Archive | Delete |
|---|---|---|---|---|---|
| DRAFT | ✅ | ✅ | ✅ (if complete) | ✅ | ✅ |
| ACTIVE | ✅ | ✅ (warn: affects live tenants) | — | ✅ | ❌ |
| ARCHIVED | ✅ | ✅ | ✅ (if complete) | — | ❌ |

Notes for the UI:

- **Archive** hides the plan from new subscriptions. Existing subscriptions keep running on it. Confirm
  with: "Existing tenants keep this plan; new tenants can't be put on it."
- **Delete** is only for DRAFT plans (never subscribed). Use a destructive confirm.
- Editing **limits or features of an ACTIVE plan** changes entitlements for **all current subscribers
  immediately**. Show a warning confirm.
- Changing a **price** does **not** change what existing subscribers pay. Subscriptions snapshot their
  agreed price. Only new or changed subscriptions use the new price. Say this in the price dialog.
- `code` cannot be edited after creation (not accepted by PATCH).

---

## 4. Endpoints

Base path: `/platform/plans`. All endpoints need `Authorization: Bearer <platform access token>`.

Permissions (the frontend gets them from `GET /platform/auth/me` → `permissions: string[]`):

- `PLANS_READ`: list/view. All platform roles have it.
- `PLANS_MANAGE`: every write. Only `SUPER_ADMIN` and `BILLING_ADMIN`. **Hide or disable write
  actions** when the permission is missing (the backend still enforces it with `403 PLATFORM_PERMISSION_DENIED`).

Money: amounts are **decimal strings** in LKR, both ways, e.g. `"5000.00"`. Never send JS numbers.
Format for display as `LKR 5,000.00`. Input regex: `^\d{1,10}(\.\d{1,2})?$`; the backend normalises
`"5000"` to `"5000.00"`.

Dates are ISO-8601 strings (UTC).

The backend rejects unknown body properties (`400`), so send only the documented fields.

### Response shapes

```ts
type PlanResponse = {
  id: string; code: string; name: string; description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  isPublic: boolean; sortOrder: number;
  archivedAt: string | null; createdById: string;
  createdAt: string; updatedAt: string;
};

type PlanPriceResponse = {
  id: string;
  billingPeriod: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  amount: string;                   // "5000.00"
  status: 'ACTIVE' | 'ARCHIVED';
  archivedAt: string | null; createdAt: string;
};

type PlanDetailsResponse = PlanResponse & {
  prices: PlanPriceResponse[];      // ACTIVE prices only, ordered MONTHLY, QUARTERLY, ANNUAL
  limits: { code: PlanLimitCode; value: number | null }[];   // null = unlimited
  features: PlanFeatureCode[];
};

type ErrorResponse = { statusCode: number; code: string; message: string };
```

**Every write endpoint returns the full updated `PlanDetailsResponse`** (except DELETE). Replace your
cached plan with the response; no refetch is needed.

### 4.1 List plans

`GET /platform/plans?status=&isPublic=&search=&page=1&pageSize=20` · `PLANS_READ`

- `status`: optional `DRAFT|ACTIVE|ARCHIVED`.
- `isPublic`: optional `true|false`.
- `search`: matches code or name (case-insensitive, max 100 chars).
- `page` ≥ 1 (default 1), `pageSize` 1–100 (default 20).
- Sorted by `sortOrder` asc, then creation date.

```json
{ "items": [PlanResponse], "total": 12, "page": 1, "pageSize": 20 }
```

List items **do not** include prices, limits or features. Open the detail view for those.

### 4.2 Get plan details

`GET /platform/plans/:id` · `PLANS_READ` → `PlanDetailsResponse` · `404 PLAN_NOT_FOUND`

### 4.3 Price history

`GET /platform/plans/:id/prices?includeArchived=true` · `PLANS_READ`

→ `{ "items": [PlanPriceResponse] }`, newest first. Without `includeArchived` (default `false`) it
returns active prices only. Use `includeArchived=true` for a "Price history" table.

### 4.4 Create plan

`POST /platform/plans` · `PLANS_MANAGE` → `201 PlanDetailsResponse` (status `DRAFT`)

```json
{
  "code": "PROFESSIONAL",
  "name": "Professional",
  "description": "For multi-branch schools",
  "isPublic": true,
  "sortOrder": 20,
  "prices": [
    { "billingPeriod": "MONTHLY", "amount": "7500.00" },
    { "billingPeriod": "ANNUAL",  "amount": "75000.00" }
  ],
  "limits": [
    { "code": "MAX_STAFF_USERS", "value": 15 },
    { "code": "MAX_BRANCHES",    "value": 3 },
    { "code": "MAX_INSTRUCTORS", "value": 10 },
    { "code": "MAX_VEHICLES",    "value": null }
  ],
  "features": ["MULTI_BRANCH", "SMS_NOTIFICATIONS"]
}
```

| Field | Rules |
|---|---|
| `code` | required, `^[A-Za-z0-9_]{2,50}$`, stored uppercased, unique → `409 PLAN_CODE_TAKEN` |
| `name` | required, 1–100 chars (trimmed) |
| `description` | optional, ≤ 1000 chars; blank is stored as `null` |
| `isPublic` | optional, default `true` |
| `sortOrder` | optional int 0–10000, default `0` |
| `prices` | optional, ≤ 3, one per billing period → `400 PLAN_PRICE_DUPLICATE_PERIOD` |
| `limits` | optional. **If sent, it must contain all 4 codes exactly once** → `400 PLAN_LIMITS_INVALID` |
| `features` | optional, unique feature codes |

### 4.5 Update plan details

`PATCH /platform/plans/:id` · `PLANS_MANAGE` → `PlanDetailsResponse`

Body: any subset of `{ name, description, isPublic, sortOrder }`. `description: null` clears it.
Sending identical values is a no-op (it still returns 200).

### 4.6 Activate / archive / delete

| Action | Request | Success | Errors |
|---|---|---|---|
| Activate | `POST /platform/plans/:id/activate` (no body) | `200 PlanDetailsResponse` | `409 INVALID_PLAN_STATE` (already active), `409 PLAN_NOT_ACTIVATABLE` (message lists blockers, e.g. `no active price; missing limits: MAX_BRANCHES`) |
| Archive | `POST /platform/plans/:id/archive` (no body) | `200 PlanDetailsResponse` | `409 INVALID_PLAN_STATE` (already archived) |
| Delete | `DELETE /platform/plans/:id` | `204` (no body) | `409 INVALID_PLAN_STATE` ("Only draft plans can be deleted") |

### 4.7 Set a price (create or change)

`PUT /platform/plans/:id/prices/:billingPeriod` · `PLANS_MANAGE` → `PlanDetailsResponse`

`:billingPeriod` = `MONTHLY | QUARTERLY | ANNUAL` (path). Body: `{ "amount": "8000.00" }`.

- No active price for that period yet: creates one.
- An active price exists with a different amount: archives it and creates a new price with a **new id**.
- Same amount: no-op.

UI: one row per billing period with "Set price" / "Change price". Don't cache price ids across edits;
read them from the response.

### 4.8 Archive a price (stop offering a billing period)

`POST /platform/plans/:id/prices/:priceId/archive` · `PLANS_MANAGE` → `PlanDetailsResponse`

Errors: `404 PLAN_PRICE_NOT_FOUND` (not on this plan), `409 PLAN_PRICE_ALREADY_ARCHIVED`,
`409 PLAN_LAST_ACTIVE_PRICE` (an ACTIVE plan must keep one). Disable the button on the last active
price of an ACTIVE plan.

### 4.9 Set limits (replace all)

`PUT /platform/plans/:id/limits` · `PLANS_MANAGE` → `PlanDetailsResponse`

```json
{ "limits": [
  { "code": "MAX_STAFF_USERS", "value": 5 },
  { "code": "MAX_BRANCHES",    "value": 1 },
  { "code": "MAX_INSTRUCTORS", "value": 3 },
  { "code": "MAX_VEHICLES",    "value": null }
] }
```

Always send **all 4** codes → otherwise `400 PLAN_LIMITS_INVALID`. UI: a form with one row per limit,
each with a number input (0–1,000,000) and an "Unlimited" toggle (sends `null`). Pre-fill from
`plan.limits`.

### 4.10 Set features (replace all)

`PUT /platform/plans/:id/features` · `PLANS_MANAGE` → `PlanDetailsResponse`

```json
{ "features": ["MULTI_BRANCH", "ADVANCED_REPORTING"] }
```

Send the full list of enabled features; `[]` removes all. UI: a checkbox list of the 4 feature codes.

---

## 5. Errors to handle

All errors look like `{ statusCode, code, message }`. Switch on `code`, not on `message`.

| HTTP | code | Where | UI handling |
|---|---|---|---|
| 400 | `BAD_REQUEST` | DTO validation (bad regex, unknown field, out of range) | show `message` (multiple problems are joined with `; `) |
| 400 | `INVALID_AMOUNT` | prices | field error on the amount |
| 400 | `PLAN_LIMITS_INVALID` | create/limits | "All limits must be set" |
| 400 | `PLAN_PRICE_DUPLICATE_PERIOD` | create | field error on the duplicated period |
| 401 | `AUTHENTICATION_REQUIRED` / `INVALID_ACCESS_TOKEN` / `SESSION_INVALID` | any | try `POST /platform/auth/refresh` once, else go to login |
| 403 | `PASSWORD_CHANGE_REQUIRED` | any | redirect to change-password |
| 403 | `PLATFORM_PERMISSION_DENIED` | writes | "You don't have permission" |
| 404 | `PLAN_NOT_FOUND`, `PLAN_PRICE_NOT_FOUND` | detail/price | not-found state |
| 409 | `PLAN_CODE_TAKEN` | create | field error on code |
| 409 | `INVALID_PLAN_STATE`, `PLAN_NOT_ACTIVATABLE`, `PLAN_PRICE_ALREADY_ARCHIVED`, `PLAN_LAST_ACTIVE_PRICE` | lifecycle/price | toast with `message`, then refetch the plan |
| 429 | `TOO_MANY_REQUESTS` | login/refresh only | "Too many attempts, try again shortly" |

---

## 6. Screens to build

1. **Plans list** (`/plans`): table with code, name, status badge, public/private, sortOrder,
   updatedAt. Filters for status, public, and search; server-side pagination. "New plan" button
   (PLANS_MANAGE only).
2. **Create plan wizard** (`/plans/new`): steps from §2, then a single `POST`. On success, go to
   the detail page and offer "Activate now" if it is complete.
3. **Plan detail** (`/plans/:id`), with sections:
   - Header: name, code, status badge, actions (Edit, Activate, Archive, Delete) per the §3 matrix.
   - Prices: one row per billing period (current amount or "Not offered"), Set/Change and Archive
     buttons. "View history" opens `GET …/prices?includeArchived=true`.
   - Limits: read view plus an edit form (§4.9). Warn when the plan is ACTIVE.
   - Features: checkbox list plus save (§4.10). Warn when the plan is ACTIVE.
   - Activation checklist while not ACTIVE (✓ price, ✓ all 4 limits).
4. Shared: permission-aware buttons, LKR formatting helper, error-code mapping (§5), refresh-token
   handling.

---

## 7. Auth prerequisites (already in the backend)

- `POST /platform/auth/login` `{ email, password }` →
  `{ tokenType, accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt, mustChangePassword }`
- `POST /platform/auth/refresh` `{ refreshToken }` → same shape. Rotation: **always store the new
  refresh token**, because reusing an old one revokes every session.
- `POST /platform/auth/logout` (204), `POST /platform/auth/change-password`
  `{ currentPassword, newPassword }` (204).
- `GET /platform/auth/me` → `{ id, email, fullName, role, mustChangePassword, permissions }`.

---

## 8. Backend notes / known gaps (tell the backend team)

- **CORS** is enabled only for the origins listed in the backend env `CORS_ORIGINS` (comma-separated
  exact origins; local dev uses `http://localhost:3000`). Bearer tokens only, no cookies/credentials.
  Ask the backend team to add the production dashboard origin.
- There is no global route prefix (no `/api`). Paths are exactly as written above. The default port
  is `3000` (`PORT` env).
- No OpenAPI/Swagger yet. This document is the contract.
- Plan-limit and feature **enforcement** inside tenant operations is a later backend chunk. The
  catalogue screens don't depend on it.
