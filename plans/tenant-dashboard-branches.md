# Frontend plan — Tenant dashboard: Settings → Branches and the active branch

**Audience:** the frontend agent building the tenant (driving-school) dashboard (`../drivingschoolhq`).

**Prerequisite:** sign-in, the BFF cookie session and `GET /tenant/auth/me` are covered by
`plans/tenant-auth-plan.md`. This doc assumes the user is signed in and `me` is loaded.

**Scope:**
1. The **active branch**: picking it, switching it, and making every branch-scoped request use it.
2. **Settings → Branches**: listing, viewing, creating, editing, closing and reopening branches,
   depending on the user's role.

Related: staff management is in `plans/tenant-dashboard-staff.md`; the branch profile (licence,
grade, vehicle classes) is in `plans/tenant-dashboard-branch-profile.md`; instructors are in
`plans/tenant-dashboard-instructors.md`.

**All calls go through the BFF:** `fetch('/api/proxy/<backend path>')` via `apiFetch`. Never call the
API directly, and never send a `tenantId`; the backend takes the school from the session.

**Error shape:** `{ statusCode, code, message }`; switch on `code`.

---

## 1. Concepts

```text
Tenant (one driving school)
 ├── Branch 1..n          always ≥ 1 ACTIVE; "Main Branch" exists from day one
 └── TenantUser
       ├── role           OWNER | ADMIN | BRANCH_MANAGER | FRONT_DESK | INSTRUCTOR | ACCOUNTANT
       ├── branchAccess   ALL      → every ACTIVE branch, including ones created later
       │                  SELECTED → only the branches assigned to the user
       └── default branch the branch the dashboard opens in after login
```

- **Active branch.** A user works in **one branch at a time**, and the dashboard shows that branch's data.
  - Switching is a **client-side** choice. Each tab remembers its own active branch, and every
    branch-scoped request tells the backend which branch it is for (the `X-Branch-Id` header, §3).
- **Default branch.** This is the branch the dashboard opens in after login. The user can change it
  with "Make default", which is stored on the server.
- **Who can work where.** A user can work in a branch only if it belongs to their school, is
  **ACTIVE**, and they have **ALL** access or are **assigned** to it. The backend checks this on
  every request.
- **School-wide vs branch-scoped.** Customers belong to the whole school; services delivered to them
  record which branch served them (later chunks). Branch-scoped data (vehicles, instructors'
  branches, applications, sessions, invoices… in later chunks) is always read and written **for the
  active branch**.

### Enums

| Enum | Values |
|---|---|
| `TenantRole` | `OWNER`, `ADMIN`, `BRANCH_MANAGER`, `FRONT_DESK`, `INSTRUCTOR`, `ACCOUNTANT` |
| `TenantUserBranchAccess` | `ALL`, `SELECTED` |
| `BranchStatus` | `ACTIVE`, `CLOSED` |
| `District` (25) | `AMPARA`, `ANURADHAPURA`, `BADULLA`, `BATTICALOA`, `COLOMBO`, `GALLE`, `GAMPAHA`, `HAMBANTOTA`, `JAFFNA`, `KALUTARA`, `KANDY`, `KEGALLE`, `KILINOCHCHI`, `KURUNEGALA`, `MANNAR`, `MATALE`, `MATARA`, `MONARAGALA`, `MULLAITIVU`, `NUWARA_ELIYA`, `POLONNARUWA`, `PUTTALAM`, `RATNAPURA`, `TRINCOMALEE`, `VAVUNIYA` |

Display districts in title case ("Nuwara Eliya"), but send the enum value.

---

## 2. Roles and permissions

`GET /tenant/auth/me` returns `user.permissions`. **Use `permissions` for UI decisions, not role
names.** New permissions will be added over time; ignore unknown values.

| Permission | Granted to | Allows |
|---|---|---|
| `BRANCHES_MANAGE` | `OWNER`, `ADMIN` | create, edit, close and reopen branches |
| `STAFF_MANAGE` | `OWNER`, `ADMIN`, `BRANCH_MANAGER` | staff management (see `tenant-dashboard-staff.md`) |

What each user can do:

| Capability | OWNER | ADMIN (ALL) | ADMIN (SELECTED) | BRANCH_MANAGER / FRONT_DESK / INSTRUCTOR / ACCOUNTANT |
|---|---|---|---|---|
| See branches in the switcher and Settings → Branches | all ACTIVE | all ACTIVE | assigned ACTIVE | ALL → all ACTIVE; SELECTED → assigned ACTIVE |
| See closed branches ("Show closed") | all | all | assigned | ALL → all; SELECTED → assigned |
| Switch the active branch | ✓ | ✓ | ✓ | ✓ |
| Set their own default branch | ✓ | ✓ | ✓ | ✓ |
| **Create a branch** | ✓ | ✓ | ✓ (auto-assigned to it) | ✗ |
| **Edit a branch** | ✓ | ✓ (any) | ✓ (assigned only) | ✗ |
| **Close / reopen a branch** | ✓ | ✓ (any) | ✓ (assigned only) | ✗ |

Notes:
- **The OWNER always has ALL access.**
- **Other roles' access is set in staff management** (next chunk). Staff never pick their own branches.
- **Branches a user can't access** simply don't exist for them: they are absent from lists, and a
  direct link returns `404 BRANCH_NOT_FOUND`. Show the normal "not found" page.
- **Hiding is UX only.** The backend still returns `403 TENANT_PERMISSION_DENIED` if a user without
  `BRANCHES_MANAGE` calls a management endpoint. Handle it with a toast ("You don't have permission
  to do this") and a refetch of `me`, in case their role changed.

---

## 3. The active branch (app-wide)

### 3.1 State
Create one **current-branch store**, e.g. a React context plus a hook `useActiveBranch()` that
exposes `{ branch, branches, setActiveBranch, isReady }`.
- **`branches`:** `me.branches`, which is already filtered to ACTIVE branches the user can work in,
  oldest first.
- **Persisting the choice:** store `activeBranchId` in `sessionStorage` under
  `dshq.activeBranch.<userId>`. This keeps it per tab and per user, so two tabs can work in two
  branches.
- **Fallback:** also write it to `localStorage` under the same key, used when a new tab opens.
  `sessionStorage` wins when both exist.

### 3.2 Picking the active branch on app load (dashboard layout)
1. Wait for `me` (`GET /api/proxy/tenant/auth/me`).
2. **No branches:** if `me.branches` is empty (`me.user.defaultBranchId === null`), show a full-page
   block: "You are not assigned to any active branch. Ask your school owner or admin." Offer
   Logout. Render nothing branch-scoped.
3. **Pick:**
   - the stored id, if it is still in `me.branches`;
   - otherwise `me.user.defaultBranchId`.
   - Never pick an id that isn't in `me.branches`.
4. Save the choice and set `isReady`. **Don't render or fetch branch-scoped content until `isReady`.**

Optional, for long-lived tabs: validate the stored id once with `GET /api/proxy/tenant/branch-context`
(header `X-Branch-Id: <id>`).
- `200 { branch: { id, name } }`: the stored branch is still valid.
- `403 BRANCH_ACCESS_DENIED`: drop it and use the default.

### 3.3 Sending the branch
- **The `apiFetch` option:** add `apiFetch(path, { ...init, branchScoped: true })`. It sets the header
  `X-Branch-Id: <activeBranchId>`; the BFF proxy forwards it unchanged.
- **Branch-scoped endpoints** (marked in each feature's doc, e.g. vehicles and instructors later) must
  use it.
- **School-wide endpoints don't need it:** auth, `/tenant/branches`, `/tenant/me/*` and staff
  management. The backend ignores it on those, so sending it is harmless.
- **Query keys:** every React Query key for branch-scoped data **includes the branch id**, e.g.
  `['vehicles', activeBranchId, filters]`. Switching branch then automatically shows that branch's
  data, without stale cross-branch caches.

### 3.4 The branch switcher (app header)
- **Display:** a dropdown with the current branch's name, listing `me.branches` (name and district).
  - A ★ marks the default branch (`isDefault`).
  - A ✓ marks the active one.
- **Select a branch:** `setActiveBranch(id)` updates the store and storage. Branch-scoped queries
  refetch because their keys change.
  - Navigate to the same page; if it shows a single branch-scoped record (e.g.
    `/vehicles/:id`), go to its list page instead.
  - **There is no API call** to switch.
- **"Make default"** (on any non-default item): calls `PATCH /api/proxy/tenant/me/default-branch`.
  On success, invalidate `me` and show a toast: "Kandy will open by default next time".
- **One branch only:** if the user has only one branch, show its name without a dropdown.

### 3.5 When the active branch stops being valid
A branch-scoped call returns **`403 BRANCH_ACCESS_DENIED`** when the branch was closed, or the user
was unassigned or lost access. Then:
1. Refetch `me`.
2. Switch to `me.user.defaultBranchId`, or show the "no branches" block if there is none.
3. Show a toast: "You no longer have access to <branch>. Switched to <new branch>."

`400 BRANCH_REQUIRED` means a branch-scoped call was sent without the header. That is a frontend
bug: log it and use the fallback.

---

## 4. Settings → Branches

**Route:** `/settings/branches`. It appears under the **Settings** sidebar group as "Branches",
visible to **everyone**; the content depends on permissions.

### 4.1 Endpoints

All paths are behind the BFF: prefix them with `/api/proxy`. None of them are branch-scoped (no
`X-Branch-Id`).

| # | Action | Method & path | Body | Success | Who |
|---|---|---|---|---|---|
| 1 | Current user and their branches | `GET /tenant/auth/me` | — | `200 TenantMe` | everyone |
| 2 | List branches | `GET /tenant/branches?includeClosed=false\|true` | — | `200 { items: BranchListItem[] }`, oldest first | everyone (own branches) |
| 3 | View one branch | `GET /tenant/branches/:id` | — | `200 Branch` | everyone (own branches) |
| 4 | Create a branch | `POST /tenant/branches` | `{ name, address, district, phone }` | `201 Branch` | `BRANCHES_MANAGE` |
| 5 | Edit a branch | `PATCH /tenant/branches/:id` | any of `{ name, address, district, phone }` | `200 Branch` | `BRANCHES_MANAGE` + own branch |
| 6 | Close a branch | `POST /tenant/branches/:id/close` | — | `200 Branch & { lockedOutStaff: { id, fullName, email }[] }` (`CLOSED`) | `BRANCHES_MANAGE` + own branch |
| 7 | Reopen a branch | `POST /tenant/branches/:id/reopen` | — | `200 Branch` (`ACTIVE`) | `BRANCHES_MANAGE` + own branch |
| 8 | Set my default branch | `PATCH /tenant/me/default-branch` | `{ branchId }` | `200 Branch` | everyone (own ACTIVE branches) |
| 9 | Validate a branch selection | `GET /tenant/branch-context` with header `X-Branch-Id` | — | `200 { branch: { id, name } }` | everyone |

"Own branch" means one the user can access: every branch for ALL access, assigned ones for SELECTED.

```ts
type Branch = {
  id: string;
  name: string;
  address: string;
  district: District;
  phone: string;               // always "+94XXXXXXXXX"
  status: 'ACTIVE' | 'CLOSED';
  closedAt: string | null;     // ISO
  createdAt: string;
  updatedAt: string;
};
type BranchListItem = Branch & {
  isDefault: boolean;                // the user's own default
  profile: BranchProfileSummary;     // grade, licence, classes, readiness: see tenant-dashboard-branch-profile.md
};
// GET /tenant/branches/:id also returns `profile`; create/edit/close/reopen responses don't.

type TenantMe = {
  user: {
    id: string; email: string; fullName: string; role: TenantRole;
    mustChangePassword: boolean;
    branchAccess: 'ALL' | 'SELECTED';
    defaultBranchId: string | null;
    permissions: string[];     // e.g. ['BRANCHES_MANAGE']
  };
  tenant: { id: string; dsCode: string; displayName: string;
            accessStatus: 'ACTIVE' | 'GRACE_PERIOD' | 'SUSPENDED' | null };
  branches: { id: string; name: string; district: District; isDefault: boolean }[];  // ACTIVE, workable
};
```

### 4.2 Errors

| HTTP / `code` | When | UI |
|---|---|---|
| `400 BAD_REQUEST` | validation (e.g. empty name, bad phone) | Show the `message` under the form |
| `400 INVALID_PHONE` | phone passed the format check but couldn't be normalised (rare) | Field error on Phone |
| `403 TENANT_PERMISSION_DENIED` | no `BRANCHES_MANAGE` | Toast "You don't have permission to do this"; refetch `me` |
| `404 BRANCH_NOT_FOUND` | unknown branch, another school's, or one the user can't access | Not-found page or toast; refetch the list |
| `409 PLAN_LIMIT_REACHED` | create/reopen when ACTIVE branches = the plan's `MAX_BRANCHES` | Dialog: "Your plan's branch limit is reached. Close a branch or contact DrivingSchoolHQ to upgrade." The `message` contains the number. |
| `409 BRANCH_NAME_TAKEN` | name already used in this school (ignoring case) | Field error on Name: "A branch with this name already exists" |
| `409 BRANCH_CLOSED` | editing a closed branch, or making it the default | Toast; refetch |
| `409 BRANCH_ALREADY_CLOSED` | close twice (e.g. two admins at once) | Toast; refetch |
| `409 BRANCH_NOT_CLOSED` | reopen an active branch | Toast; refetch |
| `409 LAST_ACTIVE_BRANCH` | closing the only ACTIVE branch | "A school must keep at least one active branch." |

### 4.3 Field rules (create and edit forms)

| Field | Rule |
|---|---|
| `name` | required; 1–100 chars after trimming; unique in the school ignoring case |
| `address` | required; 1–500 chars after trimming |
| `district` | required; a `District` value (select) |
| `phone` | required; a Sri Lankan number. Accepts `0812223333`, `812223333` and `+94812223333`; always returned as `+94812223333`. Display it as `081 222 3333`. |

**Edit sends only the changed fields.** Sending nothing changed is a no-op that returns the branch.

### 4.4 Page layout

**Header:**
- Title "Branches".
- **"New branch"** button, shown only if `permissions` includes `BRANCHES_MANAGE`.

**Toggle:** "Show closed branches" toggles `includeClosed=true`. It's mainly for managers who reopen
branches, but available to everyone.

**Table** (data from endpoint 2):
- **Columns:**
  - Name, plus a "Default" badge when `isDefault` and a "Current" badge when it's the active branch;
  - District;
  - Phone;
  - Status (ACTIVE / CLOSED badge, plus "Closed on <date>").
- **Row actions:**
  - **Everyone:**
    - "View": a detail drawer or page using endpoint 3.
    - "Switch to this branch" (ACTIVE only; same as the header switcher).
    - "Make default" (ACTIVE and not default; endpoint 8).
  - **With `BRANCHES_MANAGE`:**
    - "Edit" (ACTIVE only; endpoint 5);
    - "Close" (ACTIVE; endpoint 6);
    - "Reopen" (CLOSED; endpoint 7).

**Empty state:** can't happen while ACTIVE-only is shown (there's always one branch the user can
access, or they see the "no branches" block from §3.2).

**Read-only users** (no `BRANCHES_MANAGE`) see the same table with only the "everyone" actions. Add a
short note: "Ask your school owner or admin to add or change branches."

### 4.5 Flows

**Create** (dialog: Name, Address, District, Phone):
1. Submit `POST /tenant/branches`.
2. On `201`:
   - invalidate `branches` and `me`, because the switcher list changes;
   - toast "Branch created";
   - offer "Switch to it".
3. A SELECTED admin is assigned to the new branch automatically, so it appears in their switcher too.
4. On `409 PLAN_LIMIT_REACHED`, close the dialog and show the limit dialog. Don't pre-check the
   limit; there is no tenant endpoint for it yet, so the backend decides.

**Edit** (same form, prefilled):
1. `PATCH` with the changed fields.
2. On `200`, invalidate `branches` and `me` (the name may show in the switcher).

**Close** (confirmation dialog):
1. **Dialog text:** "Close <name>? Its records are kept and it can be reopened later. Staff whose
   default is <name> will move to another branch. **Staff who work only in <name> will be signed
   out and can't sign in until it reopens or they get another branch.**"
   - Optional preview: list who will be locked out with
     `GET /tenant/staff?branchId=<id>&status=ACTIVE` (needs `STAFF_MANAGE`, which every
     `BRANCHES_MANAGE` role has) and keep the SELECTED users whose only `ACTIVE` branch is this one.
2. Submit `POST /:id/close`, then invalidate `branches`, `me` and `staff`.
3. If `lockedOutStaff` is non-empty, show it after closing: "These staff were signed out: … Give
   them another branch in Staff, or reopen <name>."
4. If the closed branch is **this tab's active branch**, switch as in §3.5 (after `me` refreshes).
5. Error handling: `LAST_ACTIVE_BRANCH` shows inline in the dialog, which stays open.

**Reopen:**
1. Submit `POST /:id/reopen`, then invalidate `branches` and `me`.
2. On `409 PLAN_LIMIT_REACHED`, show the limit dialog.

**Make default:**
1. Submit `PATCH /tenant/me/default-branch { branchId }`, then invalidate `me` and `branches`.
2. This changes only *the user's own* default; it doesn't affect anyone else.

### 4.6 Business rules to reflect in the UI
- **A school always has at least one ACTIVE branch.** Disable "Close" with a tooltip when only one
  ACTIVE branch is visible *and* the user has ALL access. Still handle the `409`, because a SELECTED
  admin can't see every branch.
- **Plan limits count ACTIVE branches only;** closed ones don't count.
  - A plan downgrade never closes branches; it only blocks creating or reopening more.
- **Closed branches are read-only.** They can't be edited, made default, or switched to. Their
  history stays.
- **Closing a branch** moves every affected user's default to another branch they can access. That's
  why `me` must be refetched afterwards.
- **Closing a branch locks out its exclusive staff.** SELECTED staff whose only open branch it was are
  signed out immediately. Their login returns `403 NO_ACTIVE_BRANCH` until the branch reopens or
  they are given another branch. Their assignment is kept, so reopening restores access.

---

## 5. Hooks and files (suggested)

```text
lib/api/branches.ts                      typed calls for endpoints 2–9
hooks/branches/useBranches.ts            useBranches(includeClosed), useBranch(id)
hooks/branches/useBranchMutations.ts     useCreateBranch, useUpdateBranch, useCloseBranch,
                                         useReopenBranch, useSetDefaultBranch
                                         (each onSuccess invalidates ['branches'] and ['tenant','me'])
components/branches/active-branch-provider.tsx   store + useActiveBranch()
components/branches/branch-switcher.tsx          header dropdown
components/branches/branch-form-dialog.tsx       create/edit (zod schema = §4.3)
components/branches/close-branch-dialog.tsx
app/(dashboard)/settings/branches/page.tsx
shared/constants/permissions.ts          TenantPermission.BRANCHES_MANAGE
shared/constants/districts.ts            District values + labels
shared/constants/pageUrls.ts             SETTINGS_BRANCHES = '/settings/branches'
```

**Query keys:**
- `['tenant','me']`
- `['branches', { includeClosed }]`
- `['branches', id]`
- branch-scoped feature keys always start with their resource name and include `activeBranchId`

---

## 6. Acceptance checks

1. **Owner:**
   - Signs in and lands in "Main Branch" (default ★, current ✓).
   - Creates "Kandy", which appears in the table and the switcher.
   - Switches to Kandy; after a reload the tab is still in Kandy.
   - A new tab opens in Kandy (the localStorage fallback).
   - "Make default" on Kandy, then log out and in: the dashboard opens in Kandy.
2. **Limit:** at the plan's `MAX_BRANCHES`, "New branch" → the limit dialog.
   - Close one branch, then reopen it → OK again.
   - At the limit, "Reopen" → the limit dialog.
3. **Close rules:**
   - Closing the last active branch → "must keep at least one active branch".
   - Closing a branch that is a staff member's only branch → closes, lists them as locked out;
     they are signed out and their login shows the "no open branch" message; reopening lets them in.
   - Closing the tab's active branch → the switcher moves to the default with a toast.
4. **Front desk** (SELECTED: Kandy):
   - Sees only Kandy, has no New/Edit/Close/Reopen buttons, can still "Make default".
   - Opening `/settings/branches` with the Main Branch's id in a detail link → not found.
5. **ADMIN with SELECTED access:** creates "Galle" and immediately sees it in their switcher.
   - Can't see or edit branches they aren't assigned to.
6. **Duplicate name:** creating "main branch" (any case) → a field error on Name.
7. **Two tabs:** tab A in Main Branch and tab B in Kandy keep their own branch.
   - Branch-scoped requests (later chunks) carry the right `X-Branch-Id`. Check in devtools on
     `/api/proxy/tenant/branch-context`.
8. **Revoked access:** remove a user's access to their current branch (staff chunk, or close the
   branch from another account). The user's next branch-scoped call switches branch with a toast.

---

## 7. Not available yet

- **Branch-scoped business data** (vehicles, instructors, customers' services, applications…) comes
  in later chunks. Build the active-branch plumbing now; `GET /tenant/branch-context` is the only
  branch-scoped endpoint so far.
- **Plan usage display** ("2 of 3 branches") has no tenant endpoint yet. Rely on `PLAN_LIMIT_REACHED`.
- **Suspended schools:** blocking business access comes with billing. For now, show a banner when
  `me.tenant.accessStatus` is `GRACE_PERIOD` or `SUSPENDED`.
