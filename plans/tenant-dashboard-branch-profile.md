# Frontend plan — Tenant dashboard: branch profile (licence, grade and vehicle classes)

**Audience:** the frontend agent building the tenant (driving-school) dashboard (`../drivingschoolhq`).

**Prerequisites:**
- `plans/tenant-auth-plan.md`: sign-in, the BFF session and `me`.
- `plans/tenant-dashboard-branches.md`: the active branch and Settings → Branches.

This doc adds the **branch profile** to Settings → Branches.

**Scope:**
1. **Vehicle classes:** the 13 DMT licence classes, as fixed reference data.
2. **Branch licence:** each branch's driving-school licence (number, grade, issue and expiry dates),
   with renewal history.
3. **Offered classes:** the classes each branch offers, chosen from those its grade permits.
4. **Readiness:** whether the branch profile is complete enough to operate, plus licence-expiry
   warnings.

**Backend:** branch `feat/tenancy-plans-subscriptions-auth` (`src/reference-data/vehicle-classes/`,
`src/tenant/branches/profile/`).

**All calls go through the BFF:** `apiFetch('/api/proxy/<backend path>')`. None of these endpoints
are branch-scoped, so `X-Branch-Id` is not needed; the branch is in the URL.

**Error shape:** `{ statusCode, code, message }`; switch on `code`.

---

## 1. Concepts

```text
VehicleClass (global, fixed)      A1 A B1 B C1 C CE D1 D DE G1 G J  (DMT order)
DrivingSchoolGrade                A | B | C   → decides which classes a branch MAY teach

Branch
 ├── current licence  (null until entered)   licenceNumber, grade, issuedOn, expiresOn
 ├── licence history  every licence ever recorded (renewals), newest first
 └── offered classes  ⊆ classes the current grade permits   → what the branch DOES teach
```

### Grades and permitted classes (DMT rules, from the backend)

| Grade | Permitted classes |
|---|---|
| **A** | all 13: A1, A, B1, B, C1, C, CE, D1, D, DE, G1, G, J |
| **B** | 11: A1, A, B1, B, C1, C, D1, D, G1, G, J (no CE, DE) |
| **C** | 5: A1, A, B1, B, G |

**Don't hard-code this table.** Read it from `GET /tenant/vehicle-classes` (each class lists its
`permittedGrades`). It's shown here only to explain the UI.

### Key rules
- **The grade is per branch.** Branch 1 can be Grade A while branch 2 is Grade C. The grade comes
  from the branch's **current licence**; there is no separate "grade" field.
- **Branches start without a profile.** The Main Branch (created by the platform) and new branches
  have no licence and offer no classes. OWNER or ADMIN completes the profile later.
- **Offered ⊆ permitted.** A Grade A branch may offer all 13, or e.g. only 12. A Grade C branch can
  never offer CE.
- **First licence:** recording it **pre-fills every class the grade permits**, and the school then
  unticks what it doesn't offer.
- **Renewal:** recording a new licence keeps the old one in the history.
  - A **lower grade** automatically **removes** offered classes the new grade doesn't permit. The
    response lists them in `removedVehicleClasses`.
  - A **higher grade** keeps the current offered classes; newly permitted classes are **not** added
    automatically, so the school ticks them.
- **Correction:** fixes a typo in the current licence without creating history. Correcting the grade
  downwards removes classes the same way.
- **Removing a class only affects new work.** Customer licences already issued and ongoing
  applications are unaffected; only *new* applications for that class will be refused (later
  chunks).
- **The licence is data entry only:**
  - No document upload.
  - The licence number is not checked for uniqueness.
  - **Expiry never blocks anything:** a valid licence is the school's responsibility. The dashboard
    only **warns**.
- **Readiness blockers (things that stop class-dependent work):**
  - `BRANCH_LICENCE_MISSING`: no licence recorded, so the grade is unknown.
  - `NO_VEHICLE_CLASSES_OFFERED`: a licence exists, but nothing is ticked.
- **Readiness warnings (informational only):**
  - `BRANCH_LICENCE_EXPIRED`: the expiry date has passed.
  - `BRANCH_LICENCE_EXPIRING`: expires within 30 days (`daysLeft` 0–30; the expiry day itself is
    still valid).
  - The server computes "today" in Asia/Colombo.

### Enum

| Enum | Values |
|---|---|
| `DrivingSchoolGrade` | `A`, `B`, `C` |

Display it as "Grade A", "Grade B" or "Grade C".

---

## 2. Permissions

| Capability | Who |
|---|---|
| View vehicle classes | every signed-in user |
| View a branch's profile | anyone who can access the branch (ALL access, or assigned) |
| Record, renew or correct the licence; change offered classes | **OWNER and ADMIN only**: `me.user.permissions` includes `BRANCHES_MANAGE`, plus access to that branch |

- **BRANCH_MANAGER and other roles** see the profile read-only. Hide the edit actions; the backend
  returns `403 TENANT_PERMISSION_DENIED` anyway.
- **Branches the user can't access** don't exist for them: `404 BRANCH_NOT_FOUND`.
- **Closed branches are read-only:** writes return `409 BRANCH_CLOSED`, so hide the edit actions
  when `status === 'CLOSED'`.

---

## 3. Endpoints

Prefix every path with `/api/proxy`.

| # | Action | Method & path | Body | Success | Who |
|---|---|---|---|---|---|
| 1 | List vehicle classes | `GET /tenant/vehicle-classes` | — | `200 { items: VehicleClass[] }` (DMT order) | everyone |
| 2 | Branch profile | `GET /tenant/branches/:id/profile` | — | `200 BranchProfile` | branch access |
| 3 | Record first licence / renewal | `POST /tenant/branches/:id/licence` | `RecordLicenceBody` | `201 BranchProfile & { removedVehicleClasses: string[] }` | `BRANCHES_MANAGE` |
| 4 | Correct current licence | `PATCH /tenant/branches/:id/licence` | `Partial<RecordLicenceBody>` (changed fields only) | `200 BranchProfile & { removedVehicleClasses: string[] }` | `BRANCHES_MANAGE` |
| 5 | Set offered classes | `PUT /tenant/branches/:id/vehicle-classes` | `{ codes: string[] }` (the full new set; `[]` allowed) | `200 BranchProfile` | `BRANCHES_MANAGE` |

**Changed existing endpoints** (from `tenant-dashboard-branches.md`):
- `GET /tenant/branches` items and `GET /tenant/branches/:id` now include
  `profile: BranchProfileSummary`.
- Create, edit, close and reopen responses do **not** include it, so refetch the list or detail.

### Types

```ts
type DrivingSchoolGrade = 'A' | 'B' | 'C';

type VehicleClass = {
  code: string;                         // 'A1' | 'A' | 'B1' | 'B' | 'C1' | 'C' | 'CE' | 'D1' | 'D' | 'DE' | 'G1' | 'G' | 'J'
  name: string;                         // e.g. 'Light motor lorry'
  description: string;                  // e.g. 'Goods vehicles from 3,500 kg up to 17,000 kg'
  permittedGrades: DrivingSchoolGrade[];// e.g. CE → ['A'], B → ['A','B','C']
};

type BranchLicence = {
  id: string;
  licenceNumber: string;
  grade: DrivingSchoolGrade;
  issuedOn: string;                     // 'YYYY-MM-DD' (calendar date: no timezone conversion)
  expiresOn: string;                    // 'YYYY-MM-DD', last valid day
  recordedByTenantUserId: string;       // id only (no name yet)
  createdAt: string;                    // ISO instant: when it was recorded
  updatedAt: string;                    // ISO instant: last correction
};

type ReadinessBlocker =
  | { code: 'BRANCH_LICENCE_MISSING' }
  | { code: 'NO_VEHICLE_CLASSES_OFFERED' };

type ReadinessWarning =
  | { code: 'BRANCH_LICENCE_EXPIRED'; expiredOn: string }               // 'YYYY-MM-DD'
  | { code: 'BRANCH_LICENCE_EXPIRING'; expiresOn: string; daysLeft: number };

type BranchReadiness = {
  operational: boolean;                 // true ⇔ blockers is empty (warnings may exist)
  blockers: ReadinessBlocker[];
  warnings: ReadinessWarning[];
};

type BranchProfile = {
  branchId: string;
  currentLicence: BranchLicence | null;
  licenceHistory: BranchLicence[];      // all licences incl. current, newest first
  permittedVehicleClasses: VehicleClass[]; // for the current grade; [] without a licence
  offeredVehicleClasses: VehicleClass[];   // DMT order
  readiness: BranchReadiness;
};

/** Attached to GET /tenant/branches items and GET /tenant/branches/:id. */
type BranchProfileSummary = {
  grade: DrivingSchoolGrade | null;
  licenceNumber: string | null;
  licenceExpiresOn: string | null;      // 'YYYY-MM-DD'
  offeredVehicleClasses: string[];      // codes, DMT order
  readiness: BranchReadiness;
};

type RecordLicenceBody = {
  licenceNumber: string;                // 1–100 chars, trimmed
  grade: DrivingSchoolGrade;
  issuedOn: string;                     // 'YYYY-MM-DD'
  expiresOn: string;                    // 'YYYY-MM-DD', must be after issuedOn
};
```

**Parse calendar dates without a timezone shift.** Don't use `new Date('2027-01-14')`, which is UTC
midnight and can display as the previous day. Display as e.g. "14 Jan 2027".

### Field rules

| Field | Rule |
|---|---|
| `licenceNumber` | required, 1–100 chars after trimming; any format (e.g. `DS/WP/0042`); not unique |
| `grade` | `A`, `B` or `C` |
| `issuedOn` | `YYYY-MM-DD`, a real date; may be in the past or future |
| `expiresOn` | `YYYY-MM-DD`, a real date, **after** `issuedOn`; may already be in the past (allowed, it only warns) |
| `codes` | array (max 50) of class codes; case-insensitive, duplicates ignored; each must be permitted by the branch's current grade |

**Unknown body fields are rejected** (`400`), so send only the documented fields. For PATCH, send
only the changed fields; an empty or unchanged PATCH is a no-op that returns the profile.

### Errors

| HTTP / `code` | When | UI |
|---|---|---|
| `400 BAD_REQUEST` | DTO validation: missing number, bad date format, grade not A/B/C, `codes` not an array | Show the `message` under the form |
| `400 INVALID_LICENCE_DATES` | impossible date (e.g. `2026-02-30`) or `expiresOn` ≤ `issuedOn` (including a correction against the stored date) | Field error on Expiry date: "Expiry must be after the issue date" |
| `400 UNKNOWN_VEHICLE_CLASS` | a code that doesn't exist (the `message` names it) | Should not happen when the checkbox list comes from endpoint 1; toast and refetch |
| `403 TENANT_PERMISSION_DENIED` | no `BRANCHES_MANAGE` | Toast "You don't have permission to do this"; refetch `me` |
| `404 BRANCH_NOT_FOUND` | unknown branch, another school's, or no access | Not-found page |
| `409 BRANCH_CLOSED` | any write to a closed branch | Toast "Reopen the branch to edit its profile"; refetch |
| `409 BRANCH_LICENCE_MISSING` | correcting the licence or setting classes before a licence exists | Show the "Add licence" step instead |
| `409 VEHICLE_CLASS_NOT_PERMITTED` | a class the grade doesn't permit (the `message` lists them) | Toast; refetch the profile (another admin may have changed the grade) |

**Coming in later chunks** (instructors, vehicles, applications): class-dependent actions will fail
with:
- `409 BRANCH_PROFILE_INCOMPLETE`: no licence. Link to the profile with "Complete the branch profile
  first".
- `409 VEHICLE_CLASS_NOT_OFFERED`: "This branch doesn't offer class X". Link to the profile.

Expiry never causes an error.

---

## 4. Screens

### 4.1 Settings → Branches (list): additions

Data comes from the existing `GET /tenant/branches` (`item.profile`).

- **New column "Grade":** "Grade A", or a muted "Not set".
- **New column "Classes":** chips of `offeredVehicleClasses` (collapse to "A1, A, B +6" when long).
- **Status hints on the row:**
  - blockers → an amber "Profile incomplete" badge;
  - `BRANCH_LICENCE_EXPIRED` → a red "Licence expired" badge;
  - `BRANCH_LICENCE_EXPIRING` → an amber "Licence expires in N days" badge.
- **Row action "Profile":** opens the branch profile page (§4.2), for everyone.

### 4.2 Branch profile page

**Route:** `/settings/branches/:id/profile`. Alternatively, a "Profile" tab in the branch detail
drawer or page. Data: endpoint 2, plus endpoint 1 for labels and the checkbox grid.

**Header:** branch name, status badge, and a readiness banner:

| Condition | Banner |
|---|---|
| `BRANCH_LICENCE_MISSING` | Amber: "Add this branch's driving-school licence to set its grade and vehicle classes." Show an [Add licence] button if `BRANCHES_MANAGE`. |
| `NO_VEHICLE_CLASSES_OFFERED` | Amber: "Choose at least one vehicle class this branch offers." Show an [Edit classes] button if `BRANCHES_MANAGE`. |
| `BRANCH_LICENCE_EXPIRED` | Red: "The licence expired on {expiredOn}. Record the renewed licence." Show a [Renew] button if `BRANCHES_MANAGE`. |
| `BRANCH_LICENCE_EXPIRING` | Amber: "The licence expires on {expiresOn} ({daysLeft} days)." Show a [Renew] button if `BRANCHES_MANAGE`. |

Several banners can show at once (e.g. expired and no classes).

**Card: Driving-school licence**
- **No licence:** an empty state with [Add licence] (managers).
- **Otherwise:**
  - fields: Licence number, Grade, Issued on, Expires on;
  - actions (managers, ACTIVE branch only): **[Renew licence]** (endpoint 3) and **[Edit details]**
    (endpoint 4).
- Make the difference clear in the UI:
  - *Renew* = a new licence was issued and the old one is kept in history;
  - *Edit details* = fix a typo.

**Card: Vehicle classes**
- **Grid:** all 13 classes from endpoint 1, showing the code, name and a description tooltip.
  - **Offered:** checked.
  - **Permitted but not offered:** unchecked.
  - **Not permitted by the grade:** disabled, with the tooltip "Grade {permittedGrades…} only"
    (e.g. CE: "Grade A only").
- **Read-only users** see the grid without checkboxes: offered classes highlighted, others muted.
- **Managers:** an [Edit] toggle enables the checkboxes, then Save calls endpoint 5 with the
  checked codes.
  - Allow saving an empty set, but confirm first: "This branch will offer no classes and can't take
    class-dependent work."
- **No licence:** the grid is disabled with the note "Add the licence first to set the grade."

**Card: Licence history** (collapsed when there is only one)
- Table: licence number, grade, issued, expires, recorded at (`createdAt`).
- Mark the current one.
- Grade changes between rows are visible ("B → C").

### 4.3 Optional: the active-branch hint in the header switcher
When the active branch's summary (from `GET /tenant/branches`) has blockers, show a small amber dot
on the switcher. Link it to the branch profile for managers. Warnings about expiry can use the same
dot. This is optional; don't block anything.

### 4.4 Optional: after creating a branch
After `POST /tenant/branches` succeeds, offer "Set up the branch profile now?", which goes to the
new branch's profile with the Add-licence dialog open.

---

## 5. Flows

### Add the first licence (dialog: Licence number, Grade, Issued on, Expires on)
1. `POST /tenant/branches/:id/licence`.
2. On `201`:
   - Every class the grade permits is now offered (pre-filled).
   - Show the vehicle-class card in edit mode with the hint "All Grade {X} classes are selected.
     Untick the ones this branch doesn't offer."
   - Invalidate `['branches']` and `['branches', id, 'profile']`.

### Renew the licence (same dialog, prefilled with the current number and grade, empty dates)
1. **Before submitting, if the chosen grade is lower** (it permits fewer classes), work out which
   offered classes would be dropped: the offered codes whose `permittedGrades` (endpoint 1) don't
   include the new grade.
   - If any, confirm: "Grade {new} doesn't permit {CE, DE}. They will be removed from this
     branch's classes. Existing customers and applications are not affected."
2. `POST /tenant/branches/:id/licence`.
3. On `201`:
   - If `removedVehicleClasses` is non-empty, toast "Removed classes: CE, DE".
   - For a higher grade, hint: "Grade {new} also permits {…}. Tick them in Vehicle classes if this
     branch offers them."
   - Invalidate as above.

### Edit licence details (dialog prefilled with the current values)
1. Send only the changed fields with `PATCH /tenant/branches/:id/licence`.
2. A grade change uses the same lower-grade confirmation and the same `removedVehicleClasses` toast
   as renewal.
3. History doesn't change; `updatedAt` does.

### Change offered classes
1. Send the full checked set with `PUT /tenant/branches/:id/vehicle-classes { codes }`.
2. On `200`, replace the cached profile with the response and invalidate `['branches']`.
3. On `409 VEHICLE_CLASS_NOT_PERMITTED`, refetch the profile. The grade changed in the meantime;
   show "The branch grade changed. Review the classes again."

---

## 6. Hooks and files (suggested)

```text
lib/api/vehicle-classes.ts                       GET /tenant/vehicle-classes
lib/api/branch-profile.ts                        endpoints 2–5
hooks/branches/useVehicleClasses.ts              staleTime: Infinity (reference data)
hooks/branches/useBranchProfile.ts               useBranchProfile(branchId)
hooks/branches/useBranchProfileMutations.ts      useRecordLicence, useCorrectLicence, useSetOfferedClasses
                                                 (onSuccess: setQueryData(['branches', id, 'profile'])
                                                  + invalidate ['branches'])
components/branches/profile/readiness-banners.tsx
components/branches/profile/licence-card.tsx
components/branches/profile/licence-dialog.tsx   mode: 'first' | 'renew' | 'correct' (zod = §3 field rules)
components/branches/profile/vehicle-class-grid.tsx
components/branches/profile/licence-history.tsx
lib/branches/removed-classes.ts                  removedIfGrade(offeredCodes, newGrade, classes) for the confirm dialog
app/(dashboard)/settings/branches/[id]/profile/page.tsx
shared/constants/grades.ts                       DrivingSchoolGrade values + labels
```

**Query keys:**
- `['vehicle-classes']`
- `['branches', id, 'profile']`
- the existing `['branches', { includeClosed }]` and `['branches', id]`, which now carry `profile`

---

## 7. Acceptance checks

1. **New school:**
   - The owner opens Settings → Branches: Main Branch shows "Grade: Not set" and "Profile
     incomplete".
   - The profile page shows the "Add licence" banner, and the class grid is disabled.
2. **First licence (Grade A):** after saving, all 13 classes are ticked.
   - Untick CE and save: 12 classes, and the banner is gone.
3. **Grade C branch:** CE, DE, C1, C, D1, D, G1 and J are disabled with "Grade A only" or "Grade A,
   B" tooltips.
4. **Renew A → B:** the confirm dialog lists DE (CE was already unticked).
   - After saving, the toast shows "Removed classes: DE", and the history shows two licences.
5. **Renew C → A:** offered classes are unchanged; the hint suggests the newly permitted classes.
6. **Edit details:** change the number, and the history still has the same count.
   - Set the expiry before the issue date: field error.
7. **Expired licence** (record one with `expiresOn` in the past):
   - the red banner and the "Licence expired" badge in the list show;
   - nothing else is blocked, and the branch is still `operational: true` if classes are offered.
8. **Expiring in ≤ 30 days:** the amber banner shows "{n} days".
9. **Branch manager (SELECTED: Kandy):**
   - Sees Kandy's profile read-only, with no buttons.
   - The Main Branch's profile URL shows not found.
10. **Front desk:** read-only, like the branch manager.
11. **Closed branch:** the profile is viewable; no edit actions.
12. **Empty set:** saving with nothing ticked asks for confirmation, then shows the
    `NO_VEHICLE_CLASSES_OFFERED` banner.

---

## 8. Not available yet

- **Licence document upload:** not planned. The licence is data entry only.
- **Who recorded a licence, by name:** only `recordedByTenantUserId` is returned.
- **Expiry reminders by SMS or email:** these come with notifications.
- **Instructors, vehicles and applications using the branch classes:** next chunks. They will
  return `BRANCH_PROFILE_INCOMPLETE` or `VEHICLE_CLASS_NOT_OFFERED` (see §3 Errors).
