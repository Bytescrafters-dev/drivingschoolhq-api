# Implementation plan — Tenant dashboard authentication

**Audience:** the frontend agent building the tenant (driving-school) dashboard at
`../drivingschoolhq`, and the backend agent for the small API changes in Part A.

**Scope:**
- signing in with DS code, email and password;
- the BFF cookie session;
- token refresh;
- the forced password change;
- logout;
- loading the current user (`/me`);
- protecting routes;
- UX-only permission checks.

**Out of scope:** the branch switcher and branch screens are covered by `plans/tenant-branches-frontend.md`.
This plan only gets the user signed in and loads `/me`, which that doc builds on.

**Error shape.** Every backend error looks like `{ statusCode, code, message }`, and the frontend
switches on `code`.

---

## 1. Architecture

```text
Browser (React, no tokens)
   │  fetch('/api/auth/*')          login / logout / change-password / refresh
   │  fetch('/api/proxy/<path>')    everything else
   ▼
Next.js BFF (server only)
   │  - keeps the access and refresh tokens in httpOnly cookies
   │  - adds Authorization: Bearer <access>
   │  - on 401: refresh once, retry, and rewrite the cookies
   ▼
NestJS API  /tenant/auth/*, /tenant/...
```

### Rules
- **The browser never sees a token.** Don't put tokens in `localStorage`, `sessionStorage`, React state or
  responses. The BFF's auth routes return only `{ ok, mustChangePassword }`.
- **The backend is the authority.** Middleware only checks that a cookie exists. Permission checks in
  the UI are UX only.
- **The tenant comes only from the token.** Never send a `tenantId`. The DS code is used only at login.
- **CORS is not involved.** The browser only talks to the Next.js origin; the BFF calls the API server-to-server.
  The tenant app's origin does **not** need to be in the API's `CORS_ORIGINS`.

---

## 2. Backend contract (`/tenant/auth`)

| Endpoint | Auth | Request | Success | Errors (`code`) |
|---|---|---|---|---|
| `POST /tenant/auth/login` | none, throttled | `{ dsCode, email, password }` | `200 TenantAuthTokens` | `400 BAD_REQUEST` (validation); `401 INVALID_CREDENTIALS`; `403 TENANT_CLOSED`; `403 NO_ACTIVE_BRANCH`; `429 TOO_MANY_REQUESTS` |
| `POST /tenant/auth/refresh` | none, throttled | `{ refreshToken }` | `200 TenantAuthTokens` (**new** refresh token) | `401 INVALID_REFRESH_TOKEN`; `403 NO_ACTIVE_BRANCH`; `429 TOO_MANY_REQUESTS` |
| `POST /tenant/auth/logout` | Bearer | — | `204` | `401` (already invalid; treat as success) |
| `POST /tenant/auth/change-password` | Bearer | `{ currentPassword, newPassword }` | `204` | `400 CURRENT_PASSWORD_INCORRECT`; `400 PASSWORD_REUSED`; `400 BAD_REQUEST` (length) |
| `GET /tenant/auth/me` | Bearer | — | `200 TenantMe` | `401` |
| `PATCH /tenant/me` | Bearer | `{ fullName?, phone? }` (`phone: null` clears it; not for the owner) | `200 { id, email, fullName, phone, nic, role }` | `400 BAD_REQUEST`, `400 PHONE_REQUIRED` (owner) |

Login error details:
- `INVALID_CREDENTIALS` covers an unknown school, unknown email, wrong password or a disabled user.
  All four get the same response.
- `TENANT_CLOSED` is only returned after the password has been verified.
- `NO_ACTIVE_BRANCH` (also after the password check): a staff member with SELECTED branch access
  none of whose branches is open (e.g. their only branch was closed). They can sign in again once a
  branch of theirs reopens or they are given another one.

```ts
// Server-side only. Never forwarded to the browser.
type TenantAuthTokens = {
  tokenType: 'Bearer';
  accessToken: string;
  accessTokenExpiresIn: number;      // seconds (900 by default)
  refreshToken: string;
  refreshTokenExpiresAt: string;     // ISO; 7 days by default
  mustChangePassword: boolean;
};

type TenantMe = {
  user: {
    id: string; email: string; fullName: string; phone: string | null;
    role: 'OWNER' | 'ADMIN' | 'BRANCH_MANAGER' | 'FRONT_DESK' | 'INSTRUCTOR' | 'ACCOUNTANT';
    mustChangePassword: boolean;
    branchAccess: 'ALL' | 'SELECTED';
    defaultBranchId: string | null;
    permissions: TenantPermission[];  // 'BRANCHES_MANAGE' | 'STAFF_MANAGE' so far
  };
  tenant: { id: string; dsCode: string; displayName: string;
            accessStatus: 'ACTIVE' | 'GRACE_PERIOD' | 'SUSPENDED' | null };
  branches: { id: string; name: string; district: string; isDefault: boolean }[];
};
```

### Field rules

| Field | Rule |
|---|---|
| `dsCode` | 1–30 chars; the backend trims and upper-cases it (format `DS` + digits, e.g. `DS101`) |
| `email` | valid email, ≤ 254 chars; case-insensitive |
| `password` (login) | 1–128 chars |
| `newPassword` | 12–128 chars; must differ from the current password |

### Session behaviour the frontend must respect

- **Lifetimes:**
  - Access token: 15 minutes. Refresh token: 7 days.
  - Every refresh **rotates** the refresh token; the old one stops working.
- **Reuse detection:**
  - Presenting a rotated refresh token again revokes **all** of the user's sessions.
  - So the BFF must always store the new refresh token, and must never send an old one twice (§4.6).
- **Checked on every request:** the API checks the session, user status and tenant status each time.
  - If an admin disables the user, resets their password, or the school is closed, the next call
    returns `401 SESSION_INVALID`. Refreshing then fails, and the user lands on login.
- **`mustChangePassword: true`:**
  - Every endpoint except `change-password`, `logout` and `/me` returns `403 PASSWORD_CHANGE_REQUIRED`.
  - Changing the password signs out the user's **other** sessions; the current session stays valid.
- **Suspended tenants still sign in.** `tenant.accessStatus` tells the UI to show a banner.

---

## 3. Part A — Backend prerequisites (API repo) — **DONE**

All three are implemented in the API. The notes below describe what now exists.

### A1. Return permissions from `/me`
- **Change:** add `user.permissions` to `GET /tenant/auth/me`, using the existing
  `TENANT_ROLE_PERMISSIONS` (`src/tenant/permissions/`). This mirrors `GET /platform/auth/me`.
- **Why:** the frontend can then hide actions without duplicating the role→permission map. Today the
  only permission is `BRANCHES_MANAGE`; 7b adds `STAFF_MANAGE`.
- **Done:** `user.permissions` is a string array; OWNER and ADMIN get `["BRANCHES_MANAGE"]`, other
  roles get `[]`. Treat unknown values as harmless (new permissions will appear over time).

### A2. Real client IP and user agent behind the BFF (important)
**Problem:**
- Every request now comes from the Next.js server, so `request.ip` is the BFF's IP.
- Login and refresh are throttled at 5 requests per 60 seconds **per IP**. The whole product would
  share one bucket: a handful of logins or refreshes per minute across *all schools* would get `429`
  and log users out.
- Audit logs would also record the BFF's IP and user agent.

**Fix:**
- **Backend (done):** `TRUST_PROXY` env setting, applied in `main.ts`, so `request.ip` comes from
  `X-Forwarded-For` when the request arrives through a trusted proxy.
  - `false` / empty (default): trust nobody. `X-Forwarded-For` is ignored.
  - A hop count, e.g. `1`: trust that many proxies in front of the API.
  - A list, e.g. `10.0.0.5,10.1.0.0/16,loopback`: trust only these proxy addresses.
  - `true` is rejected, because it would let anyone forge their IP.
  - Local development uses `TRUST_PROXY=loopback` (the BFF runs on the same machine).
- **BFF:**
  - On **every** backend call (auth routes and proxy), set `X-Forwarded-For` to the browser's IP.
  - The browser's IP comes from the incoming `x-forwarded-for` (set by the hosting proxy) or the
    platform-provided IP.
  - Forward the browser's `User-Agent` too.
- **Deployment rule:** with `trust proxy` on, the API must only be reachable through the BFF (private
  network or firewall). Otherwise clients can spoof `X-Forwarded-For`. Document this in `.env.example`.
- **Admin dashboard:** it has the same issue (platform login/refresh). The same `TRUST_PROXY` setting fixes it.

### A3. Docs
**Done:** `plans/tenant-branches-frontend.md` §7 now says the tenant app uses the BFF, so CORS is not
required, and lists the headers the BFF must forward. Its `/me` type includes `permissions`.

---

## 4. Part B — Frontend implementation (`../drivingschoolhq`)

The repo already contains auth scaffolding copied from the admin dashboard. Several pieces still
target the platform or are incomplete. Fix them as follows.

### 4.1 Environment and cookies

`.env.local`:
```env
BACKEND_URL=http://localhost:8001
JWT_COOKIE_NAME=dshq_tenant_at
REFRESH_COOKIE_NAME=dshq_tenant_rt
COOKIE_DOMAIN=
```
- **Cookie names must differ from the admin dashboard's** (`drivingschoolhq_jwt` / `drivingschoolhq_refresh`).
  Browsers do **not** separate cookies by port. With both apps on `localhost`, identical names
  overwrite each other's sessions. The current `.env.local` copies the admin names, so change them.
- **Run on its own port**, e.g. `next dev -p 3001`.
- **Cookie options** (already in `lib/cookies.ts`): `httpOnly`, `sameSite: 'lax'`, `secure` in
  production, `path: '/'`.
  - The access cookie's `maxAge` = `accessTokenExpiresIn`.
  - The refresh cookie's `maxAge` = time until `refreshTokenExpiresAt`.

### 4.2 Types (`types/auth.ts`, currently missing; imports are broken)
- **Types:**
  - `TenantAuthTokens` (server-only);
  - `LoginResponse { ok: true; mustChangePassword: boolean }`;
  - `TenantMe` (§2);
  - `TenantRole`, `TenantUserBranchAccess`.
- **Renames:** `PlatformAuthTokens` → `TenantAuthTokens` everywhere, `isPlatformAuthTokens` →
  `isTenantAuthTokens`, `refreshPlatformTokens` → `refreshTenantTokens`.

### 4.3 Permissions (`shared/constants/permissions.ts`)
- Replace `PlatformPermission` with `TenantPermission = { BRANCHES_MANAGE: 'BRANCHES_MANAGE' }`.
- Extend it as backend chunks add permissions.
- `hooks/auth/usePermissions.ts` reads `me.user.permissions` and fails closed while loading or on error.

### 4.4 Forwarding helper (`lib/backend-headers.ts`, new, server-only)
`backendHeaders(req, extra?)` builds the headers for every backend call:
- `content-type: application/json` when there is a body;
- `user-agent` from the browser;
- `x-forwarded-for` set to the client IP (A2);
- `authorization` when a token is given.

**Never forward:** the browser's `cookie`, `host`, `connection` or other hop-by-hop headers.

### 4.5 BFF auth routes (`app/api/auth/*`)

| Route | Behaviour |
|---|---|
| `POST /api/auth/login` | See below. |
| `POST /api/auth/refresh` | Uses the refresh cookie and the shared refresh helper (§4.6). On success it sets the cookies and returns `{ ok, mustChangePassword }`. On failure it clears the cookies and returns `401`. Rarely needed by the client, because the proxy refreshes on its own. |
| `POST /api/auth/change-password` | See below. |
| `POST /api/auth/logout` | See below. |

**Login (`POST /api/auth/login`):**
1. Validate the body with zod: `{ dsCode, email, password }`.
2. Call `POST ${BACKEND_URL}/tenant/auth/login` with `backendHeaders`.
3. **On error, pass the backend's status, `code` and `message` through** (don't collapse everything
   into a 401). The UI needs `TENANT_CLOSED` and `TOO_MANY_REQUESTS`.
4. On success, check the response shape, set both cookies, and return `{ ok: true, mustChangePassword }`.

**Change password (`POST /api/auth/change-password`):**
1. Read the access cookie and call the backend with the bearer token.
2. If the backend returns `401`, refresh once (§4.6) and retry.
3. Pass errors through as `{ code, message }` with the backend status.
4. On `204`, **keep the cookies**: the current session stays valid. Return `{ ok: true }`.
   - The scaffold currently clears the cookies; remove that.

**Logout (`POST /api/auth/logout`):**
1. Call backend `POST /tenant/auth/logout` with the access token, which revokes the session server-side.
2. If that returns `401`, refresh once and retry.
3. Ignore backend failures.
4. **Always** clear both cookies and return `{ ok: true }`.
   - The scaffold currently only clears the cookies, which leaves a live refresh token on the server.

### 4.6 Generic proxy and refresh (`app/api/proxy/[...path]/route.ts`, `lib/auth-tokens.ts`)
- **Forwarding:**
  - Forward the method, query, body and safe headers (via `backendHeaders`).
  - Forward **`X-Branch-Id`** unchanged; branch-scoped endpoints need it.
- **On a backend `401`:**
  1. Read the refresh cookie.
  2. Refresh through the shared helper and retry once with the new access token.
  3. Set both new cookies on the retried response.
  4. If refresh fails or the retry is still `401`, clear the cookies and return a plain JSON `401`.
     The client redirects; the proxy never returns a redirect.
- **Refresh deduplication and reuse safety:**
  - Keep the existing module-level `Map<oldRefreshToken, Promise<tokens | null>>`.
  - Also **cache the resolved result for ~30 seconds** instead of deleting it in `finally`.
    - **Why:** requests that started with the old cookie and arrive after the first refresh finished
      must get the same new tokens.
    - **Risk otherwise:** they present the rotated token, the backend detects reuse, and the user is
      signed out everywhere.
  - Cache failures (`null`) too, so the old token is never retried.
- **Multiple server instances:** the in-memory cache is per instance. That's fine with one Next.js
  instance (and with sticky sessions). If you scale horizontally, revisit this with a shared store.
- **Don't refresh on `403`.** Pass `403 PASSWORD_CHANGE_REQUIRED`, `403 TENANT_PERMISSION_DENIED` and
  `403 BRANCH_ACCESS_DENIED` straight through.

### 4.7 Client API wrapper (`lib/api/client.ts`)
Keep `apiFetch` and `ApiError(message, status, code)`.

| Response | Action |
|---|---|
| `401` | Clear the React Query cache, then go to `/login?next=<current path>` |
| `403 PASSWORD_CHANGE_REQUIRED` | Go to `/forceChangePassword?next=<current path>` |
| any other non-2xx | Throw `ApiError` with the backend `code` |

Branch-scoped calls add `X-Branch-Id` from the current-branch store (see `tenant-branches-frontend.md`).

### 4.8 Middleware (`middleware.ts`)
- **Protected routes** (everything except `/login`, `/forceChangePassword` and `/api/*`) need the
  **refresh cookie** to be present.
  - Check the refresh cookie, not the access cookie. The access cookie expires after 15 minutes, and
    checking it would bounce users to login even though the proxy could refresh.
  - If missing, redirect to `/login?next=<path>`.
- **`/login` with a refresh cookie:** redirect to `/`, since the user is already signed in.
- **Matcher:** exclude `_next`, static assets and `/api/*`. The API routes do their own auth.
- **`next` safety:** only accept values starting with `/` and not `//`. This prevents open redirects.
  Apply the same check in the login and change-password pages.

### 4.9 Hooks
- **`hooks/auth/useLogin.ts`:**
  - `login({ dsCode, email, password })` returns `{ mustChangePassword }` or throws an `ApiError` with a `code`.
  - `logout()` calls `/api/auth/logout`, clears the query cache and routes to `/login`.
- **`hooks/my-profile/useProfile.ts`:**
  - Restore `useMe()` with query key `['tenant','me']` on `tenant/auth/me` (typed `TenantMe`).
  - `useChangePassword()` invalidates `me` on success.
- **`hooks/auth/usePermissions.ts`:** `hasPermission(p)` and `hasRole(...roles)` from `useMe()`.

### 4.10 Pages and UI

| Route | Who | Content |
|---|---|---|
| `/login` | signed-out | See below. |
| `/forceChangePassword` | signed-in, temp password | See below. |
| `/` (dashboard group) | signed-in | See below. |
| `/my-profile` | signed-in | Read-only email, role, school. **Edit name and phone** via `PATCH /tenant/me` (owners can't clear their phone). "Change password" (current, new, confirm) via `/api/auth/change-password`; on success, show a toast saying other devices were signed out. Email and NIC are changed by a manager (or the platform, for the owner). |

**`/login` (signed-out):**
- **Fields:** DS code, email, password.
  - Remember the last DS code in `localStorage`; it is not a secret.
  - Upper-case the DS code as the user types.
- **After login:**
  - `mustChangePassword` → `/forceChangePassword?next=…`;
  - otherwise go to `next` or `/`.
- **"Forgot password?"** There is no self-service reset. Show "Ask your school owner or admin to reset
  it. Owners: contact DrivingSchoolHQ support."
- **Branding:** "Driving School HQ LK".

**`/forceChangePassword` (signed in with a temporary password):**
- **Fields:**
  - "Temporary password";
  - "New password" (12–128 chars; must differ from the temporary password);
  - "Confirm".
- **On success:** invalidate `me` and go to `next` or `/`. Don't log in again; the session continues.
- **Header:** show the user's name/school from `me` and a Logout link.
- **Branding:** replace "SmartX Solution" with "Driving School HQ LK".

**`/` (dashboard group, signed in):**
- The layout loads `me` (§5) before rendering anything that is branch-scoped.
- The sidebar user menu (`NavUser`) shows the name and email from `me.user`, plus Profile and Logout.

### 4.11 Error messages

| `code` | Message |
|---|---|
| `INVALID_CREDENTIALS` | "Incorrect DS code, email or password." |
| `TENANT_CLOSED` | "This driving school's account has been closed. Contact DrivingSchoolHQ support." |
| `NO_ACTIVE_BRANCH` | "None of your branches is open right now. Ask your school owner or admin." (on refresh too: clear the session and show this on the login page) |
| `TOO_MANY_REQUESTS` | "Too many attempts. Wait a minute and try again." |
| `CURRENT_PASSWORD_INCORRECT` | "Your current password is incorrect." |
| `PASSWORD_REUSED` | "Choose a password different from your current one." |
| `BAD_REQUEST` | Show the backend `message` (validation) |
| `401` from the proxy | Silent redirect to login with "Your session has expired" on the login page (`?reason=expired`) |
| `PASSWORD_CHANGE_REQUIRED` | Redirect (no toast) |
| `TENANT_PERMISSION_DENIED` | "You don't have permission to do this." |

---

## 5. Flows

**First login (owner or new staff):**
1. `/login`, then `POST /api/auth/login` sets the cookies and returns `{ mustChangePassword: true }`.
2. `/forceChangePassword`, then `POST /api/auth/change-password` returns `{ ok }`.
3. `me` is invalidated, and the user goes to `/`.

**Normal page load:**
1. Middleware sees the refresh cookie, and the dashboard layout calls `useMe()`.
2. `me.user.mustChangePassword` → `/forceChangePassword`.
3. `me.branches` is empty → blocking screen: "You are not assigned to any active branch. Contact your school admin."
4. `me.tenant.accessStatus` is `GRACE_PERIOD` or `SUSPENDED` → a banner.
5. Otherwise, initialise the current branch (`tenant-branches-frontend.md` §3) and render.

**Access token expiry (every 15 minutes):** the proxy sees `401`, refreshes, retries, and rewrites
the cookies. The user notices nothing.

**Session revoked (disabled, password reset by an admin, school closed, reuse detected, refresh expired):**
1. The proxy gets `401`, refresh fails, and the proxy clears the cookies and returns `401`.
2. `apiFetch` sends the user to `/login?next=…&reason=expired`.

**Logout:** `POST /api/auth/logout` revokes the backend session, clears the cookies, clears the query
cache, and goes to `/login`.

**Changing the password from the profile:** the current session continues, and other devices are
signed out.

---

## 6. Security checklist

- [ ] No token ever reaches client JS: check responses and React Query caches.
- [ ] Cookies are `httpOnly`, `secure` in production, `sameSite=lax`, with names distinct from the
      admin app.
- [ ] Every BFF backend call forwards the client IP and user agent, and never browser cookies.
- [ ] Only one refresh is sent per old refresh token. Concurrent and late requests reuse the result.
- [ ] Logout revokes the backend session.
- [ ] `next` redirect parameters are validated (relative paths only).
- [ ] Mutating BFF routes (`/api/auth/*`, `/api/proxy/*` non-GET) only accept same-origin requests.
      Check the `Origin` header against the app's own origin, and reject with `403` otherwise.
      This is CSRF defence on top of `sameSite=lax`.
- [ ] Permission-based hiding is cosmetic only; the backend still returns `403`.

---

## 7. Acceptance tests (manual or Playwright)

1. **Login:**
   - The correct DS code, email and password lands on the dashboard.
   - The wrong DS code, email or password shows the same "Incorrect…" message.
   - A closed school shows the closed message.
   - Six quick failures show the "Too many attempts" message.
2. **Temporary password:** a newly created owner is forced to `/forceChangePassword`.
   - Direct navigation to `/` bounces back there.
   - After changing, the user stays signed in.
3. **Session lifetime:**
   - Leave the app idle for more than 15 minutes, then click around: there is no logout, and the
     cookies are rotated.
   - Open 5 tabs and trigger simultaneous calls after the access token expires: the user stays signed in.
     The backend audit log has **no** `REFRESH_TOKEN_REUSE_DETECTED`.
4. **Revocation:**
   - A platform admin resets the owner's password: the next action sends the owner to login.
   - Closing the school does the same.
5. **Logout:** after logout, the old refresh cookie value (copied from devtools) is rejected by
   `POST /tenant/auth/refresh`.
6. **Cookie separation:** the admin app (`:3000`) and tenant app (`:3001`) stay signed in at the same
   time in one browser.
7. **Permissions:** OWNER and ADMIN see branch management actions; FRONT_DESK doesn't (A1).
8. **Rate limiting with A2:** two users on different IPs logging in don't share a rate limit.
9. **Direct links:**
   - `/login?next=//evil.com` stays on the app.
   - `/some/page` while signed out goes through login and lands back on `/some/page`.

---

## 8. Order of work

1. **Backend:** A1–A3 are done.
2. **Frontend plumbing:**
   - env and cookie names;
   - `types/auth.ts`;
   - renames;
   - `backend-headers`;
   - `auth-tokens` refresh cache;
   - the proxy;
   - `apiFetch`;
   - middleware.
3. **Frontend auth routes:** login, logout, change-password, refresh.
4. **Hooks:** `useLogin`, `useMe`, `useChangePassword`, `usePermissions`.
5. **Pages:**
   - login;
   - forced change-password;
   - the dashboard layout gate (`me`, the no-branch screen, the access banner);
   - the profile page;
   - `NavUser`.
6. Run the §7 acceptance checks, then move on to the branch switcher (`tenant-branches-frontend.md`).
