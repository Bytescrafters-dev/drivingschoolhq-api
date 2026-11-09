# Frontend plan — Tenant dashboard: instructors (profiles, licence and vehicle classes)

**Audience:** the frontend agent building the tenant (driving-school) dashboard (`../drivingschoolhq`).

**Prerequisites:**
- `plans/tenant-auth-plan.md`: sign-in, the BFF session and `me` (with `permissions`).
- `plans/tenant-dashboard-branches.md`: the active branch, `apiFetch(..., { branchScoped: true })`
  and the `X-Branch-Id` header.
- `plans/tenant-dashboard-staff.md`: staff management (roles, branch access, disable/enable).
- `plans/tenant-dashboard-branch-profile.md`: vehicle classes, grades, licence dialogs and the
  readiness pattern (reuse those components).

This doc adds an **Instructors** page and a **My instructor profile** entry.

**Scope:**
1. **Instructors page:** the instructors of the **active branch**: their profile status, grade,
   licence expiry and what they can teach in this branch.
2. **Instructor profile:** an instructor licence (number, grade, issue and expiry dates, with
   renewal history) and the vehicle classes the person is qualified to teach.
3. **Activate/inactivate:** active profiles use the plan's instructor seats.

**Backend:** branch `feat/tenancy-plans-subscriptions-auth` (`src/tenant/instructors/`).

**All calls go through the BFF:** `apiFetch('/api/proxy/<backend path>')`. Only the list and the
candidates endpoints are **branch-scoped** (send `X-Branch-Id`).

**Error shape:** `{ statusCode, code, message }`; switch on `code`.

**Availability (when and where an instructor can be booked) is not part of this chunk.**

---

## 1. Concepts

```text
Staff member (TenantUser)          sign-in account, role, branch access, status ACTIVE | DISABLED
 └── InstructorProfile (0..1)      status ACTIVE | INACTIVE   (no profile = SETUP_REQUIRED)
      ├── current licence          licenceNumber, grade A|B|C, issuedOn, expiresOn
      ├── licence history          every licence recorded (renewals), newest first
      └── qualified classes        ⊆ classes the licence grade permits

Teachable in branch X  =  branch X offered classes  ∩  instructor qualified classes
```

### Key rules
- **Anyone can be an instructor.** Any staff member (owner, admin, branch manager, front desk,
  accountant, instructor) may hold an instructor profile.
  - The `INSTRUCTOR` staff role is only the role for people who **only** teach.
  - People with that role but no profile show as **Setup required**.
- **The profile is school-wide, not per branch.** The person teaches in every branch their staff
  access covers:
  - `ALL` access: every branch;
  - `SELECTED` access: their assigned branches.
  Changing someone's branches in Staff changes where they teach. There is no separate
  instructor-branch setting.
- **Three separate statuses — never merge them in the UI:**

  | Status | Where | Meaning |
  |---|---|---|
  | Staff status | `user.status` | `ACTIVE` / `DISABLED`: can sign in |
  | Profile status | `profileStatus` | `SETUP_REQUIRED` / `ACTIVE` / `INACTIVE`: working instructor |
  | Availability | later chunk | when and where bookable |

- **Plan seats:** every **ACTIVE** profile uses one `MAX_INSTRUCTORS` seat.
  - A profile is ACTIVE as soon as it is created.
  - Inactivating frees the seat; reactivating needs a free seat.
  - **Disabling a staff member does NOT inactivate their profile; it keeps its seat.** Show a hint
    ("Staff disabled — inactivate the instructor profile to free the seat").
- **Grades:** the same A/B/C matrix as driving schools (see the branch profile doc).
  - The first licence pre-selects every class the grade permits, and the person opts out.
  - A lower grade (renewal or correction) removes the classes it doesn't permit; the response lists
    them in `removedVehicleClasses`.
  - A higher grade adds nothing.
- **Instructor vs branch:** a Grade A instructor keeps all 13 classes even at a Grade C branch.
  What they can **teach in this branch** is the intersection (`teachableHere`). Show both.
- **Licence expiry only warns.** Validity is the school's responsibility; nothing is blocked.
- **No deletes.** Profiles are only inactivated (training history will reference them).

### Enum
| Enum | Values |
|---|---|
| `InstructorProfileState` | `SETUP_REQUIRED`, `ACTIVE`, `INACTIVE` |
| `DrivingSchoolGrade` | `A`, `B`, `C` |

---

## 2. Permissions

`me.permissions` gains `INSTRUCTORS_VIEW` (every role) and `INSTRUCTORS_MANAGE` (OWNER, ADMIN,
BRANCH_MANAGER).

| Action | Own profile | Someone else's profile |
|---|---|---|
| See the Instructors page and any profile | everyone | everyone |
| Create profile, record/correct licence, set classes | **everyone** | `INSTRUCTORS_MANAGE` + staff rules |
| Inactivate / reactivate | `INSTRUCTORS_MANAGE` only | `INSTRUCTORS_MANAGE` + staff rules |

- **Staff rules:** the target's role must be below the actor's, and their branches within the
  actor's. So:
  - **only the owner manages the owner's profile**;
  - a branch manager manages front desk / instructor / accountant staff of their branches only.
- **Don't re-implement these rules.** Every item carries `canCreate`, `canEdit` and
  `canChangeStatus`; show or enable actions from those flags only.

---

## 3. Endpoints

| Method | Path | Branch-scoped | Who | Body | Response |
|---|---|---|---|---|---|
| GET | `/tenant/instructors?profileStatus=` | **yes** | VIEW | — | `{ items: InstructorListItem[] }` |
| GET | `/tenant/instructors/candidates` | **yes** | MANAGE | — | `{ items: InstructorView[] }` |
| GET | `/tenant/instructors/:userId` | no | VIEW | — | `InstructorDetail` |
| GET | `/tenant/me/instructor-profile` | no | anyone | — | `InstructorDetail` (own) |
| POST | `/tenant/instructors/:userId/profile` | no | `canCreate` | `LicenceBody` | `201 InstructorDetail` |
| POST | `/tenant/instructors/:userId/licence` | no | `canEdit` | `LicenceBody` | `201 InstructorDetail & { removedVehicleClasses }` |
| PATCH | `/tenant/instructors/:userId/licence` | no | `canEdit` | `Partial<LicenceBody>` | `200 InstructorDetail & { removedVehicleClasses }` |
| PUT | `/tenant/instructors/:userId/vehicle-classes` | no | `canEdit` | `{ codes: string[] }` | `200 InstructorDetail` |
| POST | `/tenant/instructors/:userId/inactivate` | no | `canChangeStatus` | — | `200 InstructorDetail` |
| POST | `/tenant/instructors/:userId/reactivate` | no | `canChangeStatus` | — | `200 InstructorDetail` |

- **IDs:** `:userId` is the **staff member's id** (`user.id`), not the profile id.
- **List:** everyone who can work in the active branch and either has a profile (any role) or has
  the `INSTRUCTOR` role. Disabled staff are included, sorted by name, not paginated.
- **Candidates:** active staff of the active branch **without** a profile whose profile the actor
  may create (people they manage, and themselves). Use it for "Add instructor profile".
- **Own profile:** non-managers use `GET /tenant/me/instructor-profile` (and its `canCreate`) to set
  up their own profile.
- **Inactivate/reactivate:** idempotent; calling them on a profile already in that state returns
  `200`.

### Types
```ts
type LicenceBody = {
  licenceNumber: string;          // 1–100 chars, trimmed, not unique
  grade: 'A' | 'B' | 'C';
  issuedOn: string;               // YYYY-MM-DD
  expiresOn: string;              // YYYY-MM-DD, after issuedOn
};

type InstructorUser = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: 'OWNER' | 'ADMIN' | 'BRANCH_MANAGER' | 'FRONT_DESK' | 'INSTRUCTOR' | 'ACCOUNTANT';
  status: 'ACTIVE' | 'DISABLED';  // staff status
};

type InstructorProfileSummary = {
  id: string;
  status: 'ACTIVE' | 'INACTIVE';
  inactivatedAt: string | null;
  grade: 'A' | 'B' | 'C' | null;
  licenceNumber: string | null;
  licenceExpiresOn: string | null; // YYYY-MM-DD
  createdAt: string;
};

type InstructorReadiness = {
  assignable: boolean;            // false when any blocker exists
  blockers: (
    | { code: 'INSTRUCTOR_SETUP_REQUIRED' }
    | { code: 'STAFF_DISABLED' }
    | { code: 'INSTRUCTOR_INACTIVE' }
    | { code: 'NO_QUALIFIED_VEHICLE_CLASSES' }
  )[];
  warnings: (
    | { code: 'INSTRUCTOR_LICENCE_EXPIRED'; expiredOn: string }
    | { code: 'INSTRUCTOR_LICENCE_EXPIRING'; expiresOn: string; daysLeft: number } // ≤ 30 days
  )[];
};

type InstructorView = {
  user: InstructorUser;
  profileStatus: 'SETUP_REQUIRED' | 'ACTIVE' | 'INACTIVE';
  profile: InstructorProfileSummary | null;
  qualifiedVehicleClasses: string[];  // codes, DMT order
  readiness: InstructorReadiness;
  canCreate: boolean;
  canEdit: boolean;
  canChangeStatus: boolean;
};

type InstructorListItem = InstructorView & {
  teachableHere: string[];        // qualified ∩ offered by the active branch
};

type InstructorLicence = {
  id: string;
  licenceNumber: string;
  grade: 'A' | 'B' | 'C';
  issuedOn: string;
  expiresOn: string;
  recordedByTenantUserId: string;
  createdAt: string;
  updatedAt: string;
};

type InstructorDetail = InstructorView & {
  currentLicence: InstructorLicence | null;
  licenceHistory: InstructorLicence[];        // newest first, current included
  permittedVehicleClasses: VehicleClass[];    // what the grade allows (empty without profile)
  branches: {                                 // ACTIVE branches they work in that you can see
    id: string;
    name: string;
    teachableVehicleClasses: string[];        // qualified ∩ that branch's offered classes
  }[];
};
// VehicleClass: see plans/tenant-dashboard-branch-profile.md (code, name, description, permittedGrades)
```

### Field rules
- **Licence fields:** the same as the branch licence dialog. Reuse the component and the
  validation.
- **Class selection:** offer only `permittedVehicleClasses`. An empty selection is allowed, but it
  makes the person unassignable (`NO_QUALIFIED_VEHICLE_CLASSES`), so warn before saving.

### Errors
| Code | When | UI |
|---|---|---|
| `400 BRANCH_REQUIRED` | list or candidates without `X-Branch-Id` | send the active branch |
| `403 BRANCH_ACCESS_DENIED` | the active branch is no longer accessible | fall back to the default branch |
| `400 INVALID_LICENCE_DATES` | impossible date, or `expiresOn` ≤ `issuedOn` | field error on expiry |
| `400 UNKNOWN_VEHICLE_CLASS` | unknown class code | shouldn't happen (pick from the list) |
| `403 INSTRUCTOR_MANAGEMENT_DENIED` | the actor may not do this to this person | toast; refresh the flags |
| `403 TENANT_PERMISSION_DENIED` | candidates without `INSTRUCTORS_MANAGE` | hide the button |
| `404 INSTRUCTOR_NOT_FOUND` | unknown or invisible person, or (GET) neither a profile nor the `INSTRUCTOR` role | "Instructor not found" |
| `409 INSTRUCTOR_PROFILE_EXISTS` | creating a second profile | refetch; open the existing one |
| `409 INSTRUCTOR_PROFILE_MISSING` | editing or changing status without a profile | refetch |
| `409 STAFF_DISABLED` | creating or reactivating for a disabled staff member | "Enable this staff member first" |
| `409 PLAN_LIMIT_REACHED` | create or reactivate with no free instructor seat | "Your plan's instructor limit is reached. Inactivate an instructor or upgrade the plan." |
| `409 VEHICLE_CLASS_NOT_PERMITTED` | a class the grade doesn't permit | shouldn't happen (offer permitted only) |

Expiry never causes an error.

---

## 4. Screens

### 4.1 Instructors page (`/instructors`, visible to everyone)
- **Title:** "Instructors — `<active branch name>`". Switching branches refetches; the query key
  includes the branch id.
- **Filter tabs:** All / Active / Setup required / Inactive (`?profileStatus=`).
- **Table columns:**
  - Name (+ role badge when it isn't `INSTRUCTOR`, e.g. "Owner");
  - Profile status badge:
    - **Active** (green), **Setup required** (amber), **Inactive** (grey);
    - plus a red **Staff disabled** badge when `user.status = DISABLED`;
  - Grade;
  - Licence expiry (with an expiring/expired warning icon from `readiness.warnings`);
  - Teaches here: chips from `teachableHere`;
  - "Qualified for N classes" in the tooltip.
- **Row actions (from the flags):**
  - **Set up profile** (`canCreate`);
  - **Open**;
  - **Inactivate** / **Reactivate** (`canChangeStatus`).
- **Header button "Add instructor profile":** shown only with `INSTRUCTORS_MANAGE`.
  - It opens a picker fed by `/candidates`, then the licence dialog.
- **Empty state:** "No instructors in this branch yet." For managers, add the Add button.

### 4.2 Instructor profile page (`/instructors/:userId`)
- **Header:** name, role, staff status, profile status, and actions from the flags.
- **Readiness banner:**
  - **blockers** (setup required, staff disabled, inactive, no classes) in amber/red;
  - **warnings** (licence expired/expiring) in yellow. Warnings never disable anything.
- **Licence card:** the current licence, with **Renew** and **Edit details**; the same flows as the
  branch licence. **History** is a collapsible list.
- **Qualified classes:** a checklist over `permittedVehicleClasses`, with **Save** (`canEdit`).
- **Branches:** one row per branch, with teachable chips. A note explains: "Teaching at a branch is
  limited to the classes that branch offers."
- **Without a profile** (`SETUP_REQUIRED`): an empty state with **Set up profile** (`canCreate`).

### 4.3 My instructor profile (user menu, everyone)
- Opens the same page for `GET /tenant/me/instructor-profile`.
- **Without a profile:** the card reads "Do you teach? Set up your instructor profile".
  - It is shown when `canCreate` is true.
  - Users with the `INSTRUCTOR` role see it as a prompt after sign-in.

### 4.4 Staff page (small additions)
- **Staff detail:** link to the instructor profile when one exists (`GET /tenant/instructors/:id`;
  `404` means none).
- **Disabling a staff member who has an ACTIVE profile:** the confirm dialog adds "Their
  instructor profile stays active and keeps its seat until you inactivate it."

---

## 5. Flows

### Set up a profile (dialog: Licence number, Grade, Issued on, Expires on)
1. `POST /tenant/instructors/:userId/profile`.
2. On 201, open the profile page. Every permitted class comes pre-selected; show a toast with
   "Untick the classes you don't teach".
3. Errors:
   - `409 PLAN_LIMIT_REACHED`: show the plan message.
   - `409 STAFF_DISABLED`: show the enable hint.

### Renew the licence
`POST .../licence`. If `removedVehicleClasses` is non-empty, show "Removed because Grade X doesn't
permit them: …".

### Edit licence details
`PATCH .../licence`, sending only the changed fields. Handle `removedVehicleClasses` the same way.

### Change qualified classes
`PUT .../vehicle-classes` with the full selection.

### Inactivate / reactivate
1. **Inactivate:** the confirm reads "They won't be assignable to new training; their seat is
   freed."
2. **Reactivate:** handle `PLAN_LIMIT_REACHED` and `STAFF_DISABLED`.

---

## 6. Hooks and files (suggested)
```text
src/features/instructors/
├── api.ts                      fetchers (list/candidates use branchScoped: true)
├── hooks.ts                    useInstructors(branchId, status), useInstructorCandidates(branchId),
│                               useInstructor(userId), useMyInstructorProfile(), mutations
├── InstructorsPage.tsx
├── InstructorProfilePage.tsx
├── AddInstructorDialog.tsx     candidate picker → LicenceDialog
├── QualifiedClassesCard.tsx
└── badges.tsx                  ProfileStatusBadge, StaffDisabledBadge
```
- **Reuse:** `LicenceDialog`, the vehicle-class chips and `ReadinessBanner` from the branch
  profile feature.
- **After any mutation:** invalidate `['instructors', branchId]` (all branches) and
  `['instructor', userId]`.

---

## 7. Acceptance checks
1. The Instructors page shows only people who work in the active branch; switching branch refetches.
2. An `INSTRUCTOR`-role staff member without a profile shows **Setup required** and uses no seat.
3. Setting up a Grade A profile pre-selects all 13 classes. At a Grade C branch, "Teaches here"
   shows A1, A, B1, B, G.
4. The owner can set up their own profile and appears in every branch's list.
5. Front desk, accountant and instructor users see the list and profiles, and can set up and edit
   their **own** profile. They can't edit other people's profiles or (in)activate their own.
6. An admin can't edit or (in)activate the owner's profile; buttons are hidden by the flags.
7. With `MAX_INSTRUCTORS` reached:
   - set up shows the plan message;
   - inactivating someone then setting up works;
   - reactivating the first person fails with the plan message.
8. Disabling a staff member keeps their profile **Active** with a **Staff disabled** badge, and the
   seat stays used.
9. Renewing at a lower grade shows the removed classes.
10. An expiring or expired licence shows a warning and blocks nothing.
11. A user with no profile sees the "Set up your instructor profile" prompt in My instructor
    profile.

---

## 8. Not available yet
- **Availability:** working hours, leave and per-branch availability (next chunk).
- **Training assignments:** they will be checked with the backend's "can teach" gate: branch
  offers the class → instructor assignable, in the branch and qualified.
- **Platform admin view:** instructor usage against `MAX_INSTRUCTORS` (later).
