# Frontend plan — Tenant app: sign-in, branch switching and branch management

Audience: frontend agent building the **tenant (driving-school) app**, the dashboard school staff
use. It is a different app and audience from the platform admin dashboard. This document is the
contract for:
- signing in;
- the **current-branch** concept every later screen depends on;
- managing branches.

Everything here reflects the backend on branch `feat/tenancy-plans-subscriptions-auth`
(`src/tenant/auth/`, `src/tenant/branches/`). Error shape everywhere: `{ statusCode, code, message }`.
Switch on `code`.

---

## 1. Concepts and how they relate

```text
Tenant (driving school, DS code)
 ├── Branch 1..n            "Main Branch" exists from day one; more are added up to the plan's MAX_BRANCHES
 └── TenantUser             signs in with DS code + email + password
       ├── role             OWNER | ADMIN | BRANCH_MANAGER | FRONT_DESK | INSTRUCTOR | ACCOUNTANT
       ├── branchAccess     ALL (every active branch, including future ones) | SELECTED (assigned branches only)
       └── defaultBranchId  branch the app opens in after login
```

- **Every school always has at least one ACTIVE branch.** It starts with "Main Branch", which the
  owner can rename or edit.
- **A user works in one branch at a time:** the *current branch*. They can switch between the
  branches they can access.
- **The OWNER always has `ALL` access.** Other users may have `ALL` or `SELECTED` branches (staff
  management comes in the next chunk).
- **Branch-scoped data** (vehicles, instructors, customers' services, applications, … in later
  chunks) is always read and written **for the current branch**. The backend decides the branch from
  the `X-Branch-Id` header (§3), never from request bodies.
- **Customers belong to the whole school** and can move between branches. Each service record notes
  the branch that delivered it (later chunks).

### Enums

| Enum | Values |
|---|---|
| `TenantRole` | `OWNER`, `ADMIN`, `BRANCH_MANAGER`, `FRONT_DESK`, `INSTRUCTOR`, `ACCOUNTANT` |
| `TenantUserBranchAccess` | `ALL`, `SELECTED` |
| `BranchStatus` | `ACTIVE`, `CLOSED` |
| `District` (25) | `AMPARA`, `ANURADHAPURA`, `BADULLA`, `BATTICALOA`, `COLOMBO`, `GALLE`, `GAMPAHA`, `HAMBANTOTA`, `JAFFNA`, `KALUTARA`, `KANDY`, `KEGALLE`, `KILINOCHCHI`, `KURUNEGALA`, `MANNAR`, `MATALE`, `MATARA`, `MONARAGALA`, `MULLAITIVU`, `NUWARA_ELIYA`, `POLONNARUWA`, `PUTTALAM`, `RATNAPURA`, `TRINCOMALEE`, `VAVUNIYA` |

---

## 2. Sign-in and session (`/tenant/auth`)

| Endpoint | Body | Response / notes |
|---|---|---|
| `POST /tenant/auth/login` | `{ dsCode, email, password }` (DS code and email are case-insensitive) | `200 { tokenType, accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt, mustChangePassword }`. `401 INVALID_CREDENTIALS` (same for unknown school, unknown email, wrong password, disabled user). `403 TENANT_CLOSED`. `429` when throttled. |
| `POST /tenant/auth/refresh` | `{ refreshToken }` | Same shape. **Always store the new refresh token**: reusing an old one signs the user out everywhere. `401 INVALID_REFRESH_TOKEN`. |
| `POST /tenant/auth/change-password` | `{ currentPassword, newPassword }` (12–128 chars) | `204`. `400 CURRENT_PASSWORD_INCORRECT`, `400 PASSWORD_REUSED`. Other sessions are signed out. |
| `POST /tenant/auth/logout` | — | `204` |
| `GET /tenant/auth/me` | — | see below |

- **Temporary passwords:** while `mustChangePassword` is true, every endpoint except change-password,
  logout and `/me` returns `403 PASSWORD_CHANGE_REQUIRED`. Route the user to a change-password
  screen right after login.
- **Expired or revoked sessions:** `401 AUTHENTICATION_REQUIRED`, `INVALID_ACCESS_TOKEN` or
  `SESSION_INVALID` means refresh once, then send the user to login. Sessions end immediately when
  an admin resets the password, disables the user, or closes the school.

`GET /tenant/auth/me` response:

```ts
type Me = {
  user: {
    id: string; email: string; fullName: string; role: TenantRole;
    mustChangePassword: boolean;
    branchAccess: 'ALL' | 'SELECTED';
    defaultBranchId: string | null;      // branch to open after login; null = no workable branch
    permissions: ('BRANCHES_MANAGE')[];  // UX only; grows as features are added
  };
  tenant: { id: string; dsCode: string; displayName: string;
            accessStatus: 'ACTIVE' | 'GRACE_PERIOD' | 'SUSPENDED' | null };
  branches: { id: string; name: string; district: District; isDefault: boolean }[];
                                          // ACTIVE branches the user can switch to, oldest first
};
```

`defaultBranchId` is already resolved. If the stored default was closed, it falls back to the user's
first workable branch.

---

## 3. The current branch (`X-Branch-Id`)

**Rule for the whole app:**
- Send `X-Branch-Id: <branch uuid>` on every branch-scoped request, i.e. any endpoint documented as
  "branch-scoped" (vehicles, instructors, applications, … in later chunks).
- Tenant-wide endpoints (auth, `/tenant/branches`, staff management) don't need it, and ignore it.

**Flow:**
1. After login (and after change-password), call `GET /tenant/auth/me`.
2. Pick the current branch:
   - a branch remembered **for this tab/browser** (e.g. `sessionStorage` / `localStorage`, keyed
     by user id) if it is still in `me.branches`;
   - otherwise `me.user.defaultBranchId`.
3. If `me.branches` is empty (`defaultBranchId: null`), show a blocking "You are not assigned to any
   active branch. Contact your school admin" screen.
4. Optionally validate a remembered selection with `GET /tenant/branch-context` (send `X-Branch-Id`).
   - `200 { branch: { id, name } }`: the selection is valid.
   - `403 BRANCH_ACCESS_DENIED`: drop it and fall back to the default.
5. Put a **branch switcher** in the app header showing `me.branches`:
   - Switching is purely client-side: change the stored id, send the new `X-Branch-Id`, and refetch
     branch-scoped data.
   - No API call is needed to switch, and two tabs can work in two branches at once.
6. **"Make this my default"** in the switcher calls `PATCH /tenant/me/default-branch`
   `{ branchId }`. It decides which branch opens after the next login.

**Errors on branch-scoped endpoints:**
- `400 BRANCH_REQUIRED`: no header sent (frontend bug: always send it).
- `403 BRANCH_ACCESS_DENIED`: the branch is unknown, closed, belongs to another school, or the user
  isn't assigned to it any more. Refetch `/me`, pick a new current branch, and show "Your access to
  this branch changed".

---

## 4. Branch management (`/tenant/branches`)

### Permissions

- **Viewing:** every user can list and view **the branches they can access**.
- **Creating, editing, closing and reopening:** OWNER and ADMIN only (`403 TENANT_PERMISSION_DENIED`
  otherwise). Hide those actions unless `me.user.permissions` includes `BRANCHES_MANAGE`.
  - **Create:** any OWNER/ADMIN can create a branch. An ADMIN with `SELECTED` access is
    automatically assigned to the branch they create.
  - **Edit, close and reopen:** only for branches the user can access. A `SELECTED` admin doesn't
    even see the others (`404 BRANCH_NOT_FOUND`).

### Response

```ts
type BranchResponse = {
  id: string; name: string; address: string; district: District;
  phone: string;                         // stored as +94XXXXXXXXX
  status: 'ACTIVE' | 'CLOSED'; closedAt: string | null;
  createdAt: string; updatedAt: string;
};
```

### Endpoints

| Action | Request | Success | Errors |
|---|---|---|---|
| List my branches | `GET /tenant/branches?includeClosed=false` | `{ items: (BranchResponse & { isDefault: boolean })[] }`, oldest first. `includeClosed=true` adds CLOSED ones (for a "Closed branches" section). | — |
| View | `GET /tenant/branches/:id` | `BranchResponse` | `404 BRANCH_NOT_FOUND` |
| Create | `POST /tenant/branches` `{ name, address, district, phone }` | `201 BranchResponse` | `409 PLAN_LIMIT_REACHED`, `409 BRANCH_NAME_TAKEN`, `400` validation |
| Edit | `PATCH /tenant/branches/:id`, any of `{ name, address, district, phone }` | `BranchResponse` | `409 BRANCH_CLOSED`, `409 BRANCH_NAME_TAKEN`, `404` |
| Close | `POST /tenant/branches/:id/close` (no body) | `BranchResponse` (`CLOSED`) | `409 LAST_ACTIVE_BRANCH`, `409 BRANCH_HAS_EXCLUSIVE_STAFF`, `409 BRANCH_ALREADY_CLOSED`, `404` |
| Reopen | `POST /tenant/branches/:id/reopen` (no body) | `BranchResponse` (`ACTIVE`) | `409 PLAN_LIMIT_REACHED`, `409 BRANCH_NOT_CLOSED`, `404` |
| Set my default | `PATCH /tenant/me/default-branch` `{ branchId }` | `BranchResponse` | `409 BRANCH_CLOSED`, `404 BRANCH_NOT_FOUND` |

### Field rules

| Field | Rule |
|---|---|
| `name` | 1–100 chars, trimmed; unique within the school **ignoring case** (`BRANCH_NAME_TAKEN`) |
| `address` | 1–500 chars |
| `district` | `District` enum |
| `phone` | Sri Lankan number (`0812223333`, `812223333`, `+94812223333`); returned as `+94…` |

### Business rules to show in the UI

- **Plan limit:** ACTIVE branches can't exceed the plan's `MAX_BRANCHES` (closed branches don't
  count). On `PLAN_LIMIT_REACHED`, show "Your plan allows N branches. Contact us to upgrade". The
  message contains the limit. A plan downgrade never closes existing branches; it only blocks
  creating or reopening more.
- **Closing** (confirm dialog):
  - The branch's data is kept, and it can be reopened later.
  - The last active branch can't be closed.
  - A branch can't be closed while it is the **only** branch of some active staff member
    (`BRANCH_HAS_EXCLUSIVE_STAFF`; the message lists them). Give them another branch first.
  - Users whose default was this branch move to another branch they can access.
  - If the closed branch is the **current branch** in this tab, switch to the default (refetch `/me`).
- **Closed branches are read-only** until reopened.
- **After creating or closing a branch, refetch `/me`** so the switcher's branch list is up to date.

---

## 5. Screens to build

1. **Login**: DS code, email, password. Then a forced **change-password** screen when
   `mustChangePassword`.
2. **App shell**: header with the school name (`me.tenant.displayName`), the **branch switcher**
   (current branch name, a list of `me.branches`, a "default" star, and "Make default"), and a
   user menu (change password, logout).
   - If `me.tenant.accessStatus` is `SUSPENDED` or `GRACE_PERIOD`, show a banner (enforcement
     comes with billing).
3. **Branches settings page** (OWNER/ADMIN):
   - a table of branches (name, district, phone, status, "Default" badge);
   - a "New branch" dialog;
   - an edit dialog;
   - close/reopen actions with the rules above;
   - a "Show closed branches" toggle (`includeClosed=true`).
4. **Read-only branch list** for other roles, showing their branches only.
5. **Shared**: an API client that injects `Authorization` and, for branch-scoped calls, `X-Branch-Id`
   from the current-branch store; the refresh-token flow; and error-code mapping (§2–§4).

---

## 6. Not available yet

- Staff management (create staff, assign branches, roles): the next chunk. It will use the same
  `branchAccess` / branch assignment model.
- Branch-scoped business screens (vehicles, instructors, customers, applications): later chunks. They
  must all send `X-Branch-Id`.
- Blocking business access for SUSPENDED tenants: comes with billing.

## 7. Backend notes

- Local API: `http://localhost:8001`. The tenant app calls it only through its Next.js BFF
  (`/api/auth/*`, `/api/proxy/*`; see `tenant-auth-plan.md`), server-to-server. CORS is therefore
  not involved, and the tenant app's origin does **not** need to be in the API's `CORS_ORIGINS`.
  The BFF must forward `X-Branch-Id`, the browser's `User-Agent`, and the client IP as
  `X-Forwarded-For` (the API trusts it per `TRUST_PROXY`).
- Platform tokens never work on `/tenant/*` and tenant tokens never work on `/platform/*`.
