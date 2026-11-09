# Frontend plan — Tenant dashboard: Settings → Staff, and My profile

**Audience:** the frontend agent building the tenant (driving-school) dashboard (`../drivingschoolhq`).

**Prerequisites:**
- `plans/tenant-auth-plan.md`: sign-in, the BFF, `me`.
- `plans/tenant-dashboard-branches.md`: the active branch, Settings → Branches.

**Scope:**
1. **Settings → Staff:** list, create, edit, change role, change branches, reset password,
   disable and enable staff.
2. **My profile:** edit your own name and phone, and change your password.

**All calls go through the BFF** (`apiFetch('/api/proxy/...')`). Staff endpoints are **school-wide**:
they don't need `X-Branch-Id`.

**Error shape:** `{ statusCode, code, message }`; switch on `code`.

---

## 1. Concepts

```text
TenantUser (a staff account; signs in to this dashboard)
 ├── role          OWNER > ADMIN > BRANCH_MANAGER > FRONT_DESK | INSTRUCTOR | ACCOUNTANT
 ├── status        ACTIVE | DISABLED        (there is no delete; disable instead)
 ├── branchAccess  ALL      → every ACTIVE branch, including future ones
 │                 SELECTED → only `branches` (≥ 1 must be ACTIVE to sign in)
 ├── defaultBranchId          where the dashboard opens after login
 └── mustChangePassword       true after create / password reset (temporary password)
```

- **The OWNER** is created by DrivingSchoolHQ (platform) and is never edited here. They always have
  ALL access.
- **A seat** is one ACTIVE user, and **the owner counts**. The plan's staff limit caps seats.
  - Disabling someone frees a seat.
  - Enabling someone needs a free seat.
- **"Instructor" here is only a login role**, for people who do nothing but teach. Teaching itself is an
  **instructor profile** (licence, grade, qualified classes) that **any** staff member may hold; see
  `plans/tenant-dashboard-instructors.md`.
- **Disabling a staff member does not touch their instructor profile.** An active profile keeps its
  `MAX_INSTRUCTORS` seat until it is inactivated on the Instructors page; mention this in the disable
  confirmation when the person has one.

---

## 2. Who can do what

`GET /api/proxy/tenant/auth/me` → `user.permissions`. **Use permissions, not role names, to show
the Staff page.**

| Permission | Roles | Allows |
|---|---|---|
| `STAFF_MANAGE` | OWNER, ADMIN, BRANCH_MANAGER | everything under `/tenant/staff` |
| `BRANCHES_MANAGE` | OWNER, ADMIN | branch management (other doc) |
| `INSTRUCTORS_VIEW` / `INSTRUCTORS_MANAGE` | every role / OWNER, ADMIN, BRANCH_MANAGER | instructors (`plans/tenant-dashboard-instructors.md`) |

Users without `STAFF_MANAGE` (FRONT_DESK, INSTRUCTOR, ACCOUNTANT) **don't see the Staff page at
all**. The API returns `403 TENANT_PERMISSION_DENIED` for every `/tenant/staff` call.

### 2.1 The rules the backend enforces

1. **Roles go down only.** You can create or manage only roles **strictly below** yours.

   | Actor | Can create / manage |
   |---|---|
   | OWNER | ADMIN, BRANCH_MANAGER, FRONT_DESK, INSTRUCTOR, ACCOUNTANT |
   | ADMIN | BRANCH_MANAGER, FRONT_DESK, INSTRUCTOR, ACCOUNTANT |
   | BRANCH_MANAGER | FRONT_DESK, INSTRUCTOR, ACCOUNTANT |

2. **Branch access is delegated, never widened.**
   - With **ALL** access you can grant ALL, or any branches.
   - With **SELECTED** access you can grant only branches you have yourself, never ALL.
3. **You can manage someone only if all their branches are also yours.** A SELECTED manager of Kandy
   can't manage someone who also works in Galle. That person is visible, but `canManage` is false.
4. **Nobody manages themselves.** Use My profile for your own name, phone and password.
5. **The owner is never manageable here.**

**Don't re-implement these rules in the UI.** The backend gives you:
- `GET /tenant/staff/options`: what *you* may grant (roles, ALL, branches), for building forms;
- `canManage` on every staff row: whether to show the action buttons.

### 2.2 Who appears in the list

| Your access | You see |
|---|---|
| ALL | every user of the school, including the owner (read-only) |
| SELECTED | users with ALL access, plus users sharing at least one of your branches |

Anyone else returns `404 STAFF_NOT_FOUND`, the same answer as an unknown id.

---

## 3. Endpoints

All of these need `STAFF_MANAGE`; prefix with `/api/proxy`.

| # | Action | Method & path | Body | Success |
|---|---|---|---|---|
| 1 | What I can grant | `GET /tenant/staff/options` | — | `200 StaffOptions` |
| 2 | List staff | `GET /tenant/staff?status=&role=&branchId=&search=&page=1&pageSize=20` | — | `200 { items: Staff[], total, page, pageSize }`, sorted by name |
| 3 | View | `GET /tenant/staff/:id` | — | `200 Staff` |
| 4 | Create | `POST /tenant/staff` | `CreateStaff` | `201 Staff` |
| 5 | Edit profile | `PATCH /tenant/staff/:id` | any of `{ fullName, email, phone, nic }`; `null` clears phone/NIC | `200 Staff` |
| 6 | Change role | `PATCH /tenant/staff/:id/role` | `{ role }` | `200 Staff` |
| 7 | Change branches | `PUT /tenant/staff/:id/branches` | `{ branchAccess, branchIds, defaultBranchId }` | `200 Staff` |
| 8 | Reset password | `POST /tenant/staff/:id/reset-password` | `{ temporaryPassword }` | `200 Staff` |
| 9 | Disable | `POST /tenant/staff/:id/disable` | — | `200 Staff` |
| 10 | Enable | `POST /tenant/staff/:id/enable` | — | `200 Staff` |

**List filters** (all optional):
- `status`: `ACTIVE | DISABLED`;
- `role`;
- `branchId`: users who can work there (ALL access or assigned);
- `search`: name or email, case-insensitive, ≤ 100 chars;
- `pageSize`: ≤ 100.

My profile endpoints (any signed-in user, no permission needed):

| Action | Method & path | Body | Success |
|---|---|---|---|
| Edit my name / phone | `PATCH /tenant/me` | `{ fullName?, phone? }`; `phone: null` clears it | `200 { id, email, fullName, phone, nic, role }` |
| Change my password | `POST /api/auth/change-password` (BFF route, see the auth plan) | `{ currentPassword, newPassword }` | `{ ok: true }`; other devices are signed out |
| Current values | `GET /tenant/auth/me` | — | `user.fullName`, `user.phone`, `user.email`, … |

### 3.1 Types

```ts
type StaffOptions = {
  roles: TenantRole[];          // roles you may assign, highest first (never OWNER)
  canGrantAll: boolean;         // you have ALL access → may grant ALL
  branches: Branch[];           // ACTIVE branches you may grant (same shape as /tenant/branches)
};

type Staff = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;         // "+94771234567"
  nic: string | null;
  role: TenantRole;
  status: 'ACTIVE' | 'DISABLED';
  mustChangePassword: boolean;  // still on a temporary password
  lastLoginAt: string | null;
  disabledAt: string | null;
  branchAccess: 'ALL' | 'SELECTED';
  branches: { id: string; name: string; status: 'ACTIVE' | 'CLOSED' }[];  // SELECTED only; [] for ALL
  defaultBranchId: string;
  hasActiveBranch: boolean;     // false → can't sign in (all their branches are closed)
  canManage: boolean;           // may YOU change this person
  createdAt: string;
  updatedAt: string;
};

type CreateStaff = {
  fullName: string;             // 1–200
  email: string;                // unique in the school (case-insensitive); the login id
  phone?: string | null;        // optional, Sri Lankan; unique not required
  nic?: string | null;          // optional; unique in the school
  role: TenantRole;             // one of options.roles
  branchAccess: 'ALL' | 'SELECTED';
  branchIds?: string[];         // SELECTED: ≥ 1, from options.branches; ALL: omit or []
  defaultBranchId: string;      // SELECTED: one of branchIds; ALL: any options.branches id
  temporaryPassword: string;    // 12–128; the user must change it at first login
};
```

### 3.2 Field rules

| Field | Rule |
|---|---|
| `fullName` | required on create; 1–200 chars after trimming |
| `email` | valid email ≤ 254 chars; stored lower-case; unique in the school |
| `phone` | optional; Sri Lankan (`0771234567`, `771234567`, `+94771234567`), returned as `+94…` |
| `nic` | optional; old (9 digits + V/X) or new (12 digits), upper-cased; unique in the school |
| `temporaryPassword` | 12–128 chars. Offer a "Generate" button and a "Copy" button. **There is no email delivery**: the manager gives it to the person, who must change it at first sign-in. |

### 3.3 Errors

| HTTP / `code` | When | UI |
|---|---|---|
| `400 BAD_REQUEST` | validation | field errors from `message` |
| `400 INVALID_PHONE` / `INVALID_NIC` | format | field error |
| `400 BRANCH_SELECTION_INVALID` | no branch selected, a closed or unknown branch, the default not among the selected, or branches sent with ALL | message on the branch picker |
| `403 TENANT_PERMISSION_DENIED` | you lack `STAFF_MANAGE` | hide the page; refetch `me` |
| `403 ROLE_NOT_ASSIGNABLE` | role not below yours | shouldn't happen when using `options.roles`; toast |
| `403 BRANCH_ACCESS_NOT_GRANTABLE` | ALL by a SELECTED user, or a branch you don't have | shouldn't happen when using `options`; toast and refetch options |
| `403 STAFF_MANAGEMENT_DENIED` | the target is a peer or higher role, the owner, or has branches outside yours | toast "You can't change this person"; refetch the row |
| `403 CANNOT_MANAGE_SELF` | acting on yourself | hide actions on your own row; point to My profile |
| `404 STAFF_NOT_FOUND` | unknown, or not visible to you | not-found page |
| `409 PLAN_LIMIT_REACHED` | create/enable with no free seat | dialog: "Your plan allows N staff accounts (including the owner). Disable someone or contact DrivingSchoolHQ to upgrade." The `message` has the number. |
| `409 TENANT_USER_EMAIL_TAKEN` / `TENANT_USER_NIC_TAKEN` | duplicate in the school | field error |
| `409 STAFF_ALREADY_DISABLED` / `STAFF_ALREADY_ACTIVE` | stale UI | toast; refetch |
| `400 PHONE_REQUIRED` | the owner tries to clear their phone on My profile | field error |

---

## 4. Screens

### 4.1 Settings → Staff (`/settings/staff`), only with `STAFF_MANAGE`

**Header:**
- Title "Staff".
- **"Add staff"** button.

**Filters:** search box; selects for role and status (default ACTIVE); branch select (from `me.branches`).
Use server-side pagination.

**Table:**
- **Columns:**
  - Name + email;
  - Role (badge);
  - Branches: "All branches", or chips with names, where **closed branches are struck through**;
  - Status;
  - Last login ("Never" when null).
- **Badges:**
  - "Temporary password" when `mustChangePassword`;
  - "Can't sign in: no open branch" (warning) when `!hasActiveBranch && status === 'ACTIVE'`.

**Row actions:** only when `canManage`.
- Edit details;
- Change role;
- Change branches;
- Reset password;
- Disable or Enable.

Your own row shows a "You" badge and a link to My profile instead.

**Detail drawer** (`GET /tenant/staff/:id`): all fields plus the same actions.

### 4.2 Add staff (dialog or page)
1. Load `GET /tenant/staff/options` when the dialog opens.
2. **Fields:** full name, email, phone (optional), NIC (optional), and role (select from
   `options.roles`).
3. **Branch access:**
   - A radio "All branches" is shown only if `options.canGrantAll`.
   - Otherwise it's "Selected branches", a multi-select of `options.branches`.
4. **Default branch:** a select limited to the chosen branches (or all of `options.branches` for ALL).
   Auto-select the first chosen branch.
5. **Temporary password:** a field with Generate and Copy.
6. **On `201`:** show a success screen. "Give <name> their email, the school's DS code (`me.tenant.dsCode`)
   and the temporary password. They'll set their own password at first sign-in." Offer "Copy all".

### 4.3 Change branches
Same branch-access controls, prefilled. Things to know:
- **Closed branches** on the person aren't shown in the picker and **are kept** by the backend. If the
  branch reopens, the person gets it back. Show them read-only under the picker: "Also assigned
  (closed): Galle".
- **The change applies immediately.** If the person is signed in and loses their current branch, their
  dashboard switches branch on its next request. No sign-out is needed.

### 4.4 Change role
- **Choices:** a select from `options.roles`.
- **Effect:** applies on the person's next request (their menus change after a `me` refetch); no
  sign-out.
- **Promotions:** promoting someone to your own rank isn't possible, because `options.roles` excludes it.

### 4.5 Edit details
- **Fields:** name, email, phone and NIC. Each can be cleared with null, except name and email.
- **Changing the email signs the person out** (it's their login). Confirm first: "<name> will need to
  sign in again with the new email."

### 4.6 Reset password
- **Dialog:** a new temporary password with Generate and Copy.
- **Effect:** the person is signed out everywhere and must change the password at next sign-in.

### 4.7 Disable / Enable
- **Disable confirmation:** "<name> will be signed out immediately and can't sign in. Their history is
  kept. This frees a staff seat."
- **Enable:** may return `409 PLAN_LIMIT_REACHED`; show the seat dialog.
- **Enabling someone whose branches are all closed** succeeds, but they still can't sign in. The
  response has `hasActiveBranch: false`; show "Give them an open branch so they can sign in", with a
  link to Change branches.

### 4.8 My profile (`/my-profile`), everyone
- **Shown read-only:** email, role, school (`me.tenant.displayName`), access ("All branches" or the
  `me.branches` names).
- **Editable:** full name and phone, via `PATCH /tenant/me`.
  - On success, invalidate `me`.
  - Owners can't clear their phone (`PHONE_REQUIRED`).
- **Email and NIC:** "Ask your school owner or admin to change your email or NIC". Owners see "Contact
  DrivingSchoolHQ support".
- **Change password:** current, new (12–128) and confirm, via `/api/auth/change-password`. Map the
  errors:
  - `CURRENT_PASSWORD_INCORRECT` → "Your current password is incorrect";
  - `PASSWORD_REUSED` → "Choose a different password".
  - On success: "Password changed. Other devices were signed out." The session continues.

---

## 5. Sign-in consequences to handle (auth layer)

| Situation | What the person sees |
|---|---|
| Disabled | login → `401 INVALID_CREDENTIALS`; open sessions end (`401` → login page) |
| Password reset by a manager | open sessions end; login with the temporary password → forced change |
| Email changed by a manager | open sessions end; login with the new email |
| All their branches closed (SELECTED) | open sessions end; login → `403 NO_ACTIVE_BRANCH`: "None of your branches is open right now. Ask your school owner or admin." |
| Role or branches changed | nothing visible except updated menus and branches; `403 BRANCH_ACCESS_DENIED` on a lost branch triggers the branch switch (branches doc §3.5) |

---

## 6. Files (suggested)

```text
lib/api/staff.ts                        typed calls 1–10
hooks/staff/useStaff.ts                 useStaffList(filters), useStaffMember(id), useStaffOptions()
hooks/staff/useStaffMutations.ts        create / update / role / branches / reset / disable / enable
                                        (onSuccess: invalidate ['staff'] and, for self-affecting
                                        changes, ['tenant','me'])
hooks/my-profile/useProfile.ts          useUpdateMyProfile(), useChangePassword()
components/staff/staff-table.tsx
components/staff/staff-form-dialog.tsx  create + edit details (zod = §3.2)
components/staff/branch-access-field.tsx  ALL/SELECTED radio, branch multi-select, default select
components/staff/temporary-password-field.tsx  generate + copy
components/staff/staff-actions.tsx      role / branches / reset / disable / enable dialogs
app/(dashboard)/settings/staff/page.tsx
app/(dashboard)/my-profile/page.tsx
shared/constants/permissions.ts         TenantPermission.STAFF_MANAGE
shared/constants/pageUrls.ts            SETTINGS_STAFF = '/settings/staff'
```

**Query keys:**
- `['staff', 'list', filters]`
- `['staff', id]`
- `['staff', 'options']`
- `['tenant', 'me']`

---

## 7. Acceptance checks

1. **Owner:**
   - Adds an ADMIN with "All branches".
   - The admin signs in with the temporary password and is forced to change it.
2. **Admin:**
   - Cannot pick ADMIN as a role.
   - Adds a BRANCH_MANAGER for Kandy + Galle with default Kandy.
3. **Branch manager:**
   - Sees no "All branches" option; only Kandy and Galle are offered.
   - Adds a FRONT_DESK for Kandy.
   - Sees the owner and the admin, but with no actions.
   - Their own row shows "You" with no actions.
4. **Seat limit:** with the plan at N seats, adding the (N+1)-th user → the seat dialog.
   - Disable someone, add again → OK.
   - Enable the disabled person → the seat dialog.
5. **Disable while signed in:** disable a signed-in clerk, and the clerk's next click goes to login.
   Their login then fails with "Incorrect DS code, email or password".
6. **Branch move:** change a signed-in clerk from Kandy to Main.
   - The clerk's dashboard moves to Main on the next request.
   - The clerk is not signed out.
7. **Closing the only branch:** close Kandy while it is a clerk's only branch.
   - The clerk is signed out.
   - Their login shows the "no open branch" message.
   - Their staff row shows "Can't sign in".
   - Reopening Kandy lets them sign in again.
8. **Email change:** change a clerk's email; the clerk is signed out and signs in with the new email.
9. **My profile:**
   - Change name and phone; the header name updates.
   - The owner can't clear their phone.
   - A password change keeps the session.
10. **No permission:** FRONT_DESK sees no Staff entry under Settings; `/settings/staff` shows "no
    permission".
