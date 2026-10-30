# Frontend plan — Admin dashboard auth fixes (`drivingschoolhq-admin`)

**Audience:** the frontend agent for the platform admin dashboard (`../drivingschoolhq-admin`).

**What this is:** fixes to the existing BFF auth layer, meaning the Next.js routes in `app/api/auth/*`,
the proxy, middleware, and the login and password pages. No new screens. No backend changes are
needed; the API already supports everything below.

**Related:** the tenant dashboard has the same scaffolding and gets the same fixes in
`plans/tenant-auth-plan.md` §4. Keep the implementations alike: the same helper names and the same
behaviour.

**Error shape.** Every backend error looks like `{ statusCode, code, message }`, and the frontend
switches on `code`.

---

## 1. Backend facts these fixes depend on (`/platform/auth/*`)

| Endpoint | Auth | Request | Success | Errors (`code`) |
|---|---|---|---|---|
| `POST /platform/auth/login` | none, throttled | `{ email, password }` | `200 PlatformAuthTokens` | `400 BAD_REQUEST`, `401 INVALID_CREDENTIALS`, `429 TOO_MANY_REQUESTS` |
| `POST /platform/auth/refresh` | none, throttled | `{ refreshToken }` | `200 PlatformAuthTokens` (**new** refresh token) | `401 INVALID_REFRESH_TOKEN`, `429 TOO_MANY_REQUESTS` |
| `POST /platform/auth/logout` | Bearer | — | `204` | `401` (already invalid; treat as success) |
| `POST /platform/auth/change-password` | Bearer | `{ currentPassword, newPassword }` | `204` | `400 CURRENT_PASSWORD_INCORRECT`, `400 PASSWORD_REUSED`, `400 BAD_REQUEST` |
| `GET /platform/auth/me` | Bearer | — | `200 { id, email, fullName, role, mustChangePassword, permissions }` | `401` |

- **Token lifetimes:**
  - The access token lasts **15 minutes**.
  - The refresh token lasts **7 days** and **rotates** on every refresh.
- **Reuse detection:** presenting an already-rotated refresh token again is treated as theft. The API
  revokes **all** of that admin's sessions.
- **Password changes:** `change-password` signs out the admin's **other** sessions. The current
  session stays valid, and its `mustChangePassword` becomes `false` immediately.
- **Rate limits:** login and refresh are limited to 5 requests per 60 seconds **per client IP**.
  - The API takes the client IP from `X-Forwarded-For` only when its `TRUST_PROXY` setting trusts the
    caller. Locally this is `TRUST_PROXY=loopback`.
  - So the BFF must send the browser's IP. Otherwise every admin shares the BFF's IP and one
    rate-limit bucket.
- **Audit:** platform audit logs record the IP and `User-Agent` of each auth event. Both must be the
  browser's, not the BFF's.

---

## 2. Required changes

### 2.1 Forward the client IP and user agent (new `lib/backend-headers.ts`, server-only)

```ts
backendHeaders(req: Request, opts?: { accessToken?: string; json?: boolean }): Headers
```

**Sets:**
- `x-forwarded-for`: the browser's IP. Use the first entry of the incoming `x-forwarded-for` when
  the app runs behind a hosting proxy, otherwise `x-real-ip`, otherwise omit the header.
- `user-agent`: copied from the incoming request.
- `content-type: application/json` when `json`.
- `authorization: Bearer <token>` when `accessToken` is given.
- For proxied calls, also keep the request's own `content-type`, `accept` and `x-branch-id`.

**Never forwards:** `cookie`, `host`, `connection`, `content-length` or other hop-by-hop headers. Don't
copy all incoming headers like `proxyToBackend` does today; build an allow-list instead.

**Where to use it:**
- every backend `fetch` in `app/api/auth/{login,refresh,logout,change-password}/route.ts`;
- `lib/auth-tokens.ts` → `refreshPlatformTokens(refreshToken, req)`, which takes the request so it
  can forward the headers;
- `lib/with-auth-proxy.ts` → `proxyToBackend` and `proxyToBackendWithAccess`.

### 2.2 Middleware checks the refresh cookie (`middleware.ts`)
- **Protected routes:** require the **refresh** cookie (`REFRESH_COOKIE_NAME`) instead of the access cookie.
  - The access cookie expires after 15 minutes, so checking it bounces admins to `/login` although
    the proxy could refresh silently.
- **`/login`:** if the refresh cookie exists, redirect to `/` (the admin is already signed in).
- **Matcher:** exclude `_next`, static files and **all** of `/api/*`. Today only `api/auth/login`
  is excluded; API routes handle auth themselves.
- **`next` safety:** only set or follow `next` values that pass `isSafeNextPath` (§2.7).

### 2.3 Logout revokes the backend session (`app/api/auth/logout/route.ts`)
1. Read the access cookie and call `POST ${BACKEND_URL}/platform/auth/logout` with `backendHeaders`.
2. If that returns `401` and a refresh cookie exists, refresh once (§2.6 helper) and retry with the
   new access token.
3. Ignore any remaining failure (network error, `401`).
4. **Always** clear both cookies and return `{ ok: true }`.

Today the route only clears the cookies. That leaves the refresh token usable for up to 7 days by
anyone who copied it.

### 2.4 Change-password keeps the session (`app/api/auth/change-password/route.ts` and the form)
**Route:**
- Call the backend with `backendHeaders`.
- If the backend returns `401`, refresh once and retry. When a refresh happened, set the new cookies
  on the response.
- On `204`, **don't call `clearAuthCookies()`**. The session is still valid. Return `{ ok: true }`.
- Pass errors through (§2.5).

**`components/auth/force-change-password.tsx`:** on success, invalidate the `me` query and
`router.replace(safe(nextPath))`. Don't send the admin back to `/login`.

**Profile page change-password:** on success, stay on the page and show a toast: "Password changed.
Other devices were signed out."

### 2.5 Pass backend errors through (login, refresh, change-password routes)
- On a non-2xx response, return the backend's **status**, `code` and `message` instead of a flat
  `401 { message: "Invalid credentials" }`.
- **Bad response body:** if the backend body isn't JSON, return the status with
  `{ code: "UNKNOWN_ERROR", message: "Something went wrong" }`.
- **Unreachable backend:** a network failure returns
  `502 { code: "BACKEND_UNAVAILABLE", message: "Service unavailable. Try again shortly." }`.
- **Login:** keep validating the success body with `isPlatformAuthTokens`. Still return only
  `{ ok, mustChangePassword }`, never tokens.

UI messages (login form, password forms):

| `code` | Message |
|---|---|
| `INVALID_CREDENTIALS` | "Incorrect email or password." |
| `TOO_MANY_REQUESTS` | "Too many attempts. Wait a minute and try again." |
| `CURRENT_PASSWORD_INCORRECT` | "Your current password is incorrect." |
| `PASSWORD_REUSED` | "Choose a password different from your current one." |
| `BAD_REQUEST` | the backend `message` |
| `BACKEND_UNAVAILABLE` | the message above |

### 2.6 Refresh: dedupe, and protect against reuse (`lib/auth-tokens.ts`, `app/api/proxy/[...path]/route.ts`)

**Problem:**
- `pendingRefreshes` deletes its entry in `finally` as soon as the refresh completes.
- A request that started with the **old** refresh cookie can arrive just after that, for example
  from another tab or a parallel query. It refreshes again with the rotated token.
- The API sees reuse and **signs the admin out everywhere**.

**Fix:**
- Move the dedupe into `lib/auth-tokens.ts` as `refreshOnce(refreshToken, req)`, so the proxy,
  logout and change-password all share it.
- Keep `Map<oldRefreshToken, { promise, expiresAt }>`. Keep each entry for **30 seconds** after it
  settles, and cache `null` results too. Later requests with the same old token reuse the same
  result instead of calling the API.
- Prune expired entries on access.
- With multiple Next.js instances the cache is per instance. That's acceptable for now (note it in a
  comment).

**Proxy behaviour:** keep the existing flow and don't refresh on `403`.
1. Call the backend.
2. On `401`: `refreshOnce` → retry once → set both new cookies on the response.
3. If refresh fails or the retry is still `401`, clear the cookies and return a plain JSON `401`.

### 2.7 Open-redirect guard (new `lib/safe-next.ts`)
```ts
export const isSafeNextPath = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\');
export const safeNext = (v: unknown) => (isSafeNextPath(v) ? v : '/');
```
- **Use it in:**
  - the login page and `LoginForm` (after login);
  - the force-change-password page and form;
  - middleware (when building `?next=`);
  - `lib/api/client.ts` redirects.
- **Encoding:** always `encodeURIComponent` the value when putting it in a URL (some places currently
  build `?next=${nextPath}` raw).

### 2.8 Reject cross-site requests (new `lib/same-origin.ts`)
- **Scope:** every **non-GET** request to `/api/auth/*` and `/api/proxy/*`.
- **Check:** the `Origin` header must equal the app's own origin (from `getAppBaseUrl()` in
  `lib/base-url.ts`, or an `APP_ORIGIN` env value).
- **Otherwise:** return `403 { code: "CSRF_REJECTED" }`.
- **Missing `Origin`:** reject too; modern browsers always send it on POST, PUT, PATCH and DELETE.
- **Why:** this is defence in depth on top of `sameSite=lax`. Implement it once (a wrapper used by
  each route handler) rather than per route.

---

## 3. Housekeeping

- Run the admin app on port **3000** and the tenant app on **3001**.
  - Browsers share cookies across ports on `localhost`. The admin cookie names
    (`drivingschoolhq_admin_jwt` / `drivingschoolhq_admin_refresh`) must stay different from the
    tenant app's.
- The admin app calls the API only through the BFF, so the browser never needs CORS. Nothing to change
  in the admin app.

---

## 4. Acceptance checks (manual)

1. **Session lifetime:**
   - Sign in, stay idle for more than 15 minutes, then navigate: no redirect to login, and the cookies are rotated.
   - Open 5 tabs, let the access token expire, and reload them together: everyone stays signed in.
     The platform audit log (`GET /platform/audit-logs`) shows **no** `REFRESH_TOKEN_REUSE_DETECTED`.
2. **Logout:** copy the refresh cookie value, log out, then
   `POST /platform/auth/refresh { refreshToken: <copied> }` → `401`.
3. **First login:** with a temporary password, sign in, go to the forced change, submit, and land on
   the dashboard **without** logging in again.
4. **Login errors:** a wrong password shows "Incorrect email or password". Six quick attempts show
   "Too many attempts". Stopping the API shows "Service unavailable".
5. **Real client IPs:** with the API on `TRUST_PROXY=loopback`, login audit entries show the
   browser's IP and user agent, not the Next.js server's.
6. **Open redirect:** `/login?next=//evil.com` and `/login?next=https://evil.com` land on `/` after login.
7. **Cross-site requests:** a POST to `/api/proxy/platform/plans` with `Origin: https://evil.com` → `403`.
8. **Both apps signed in together:** the admin (`:3000`) and tenant (`:3001`) apps stay signed in at
   the same time in one browser.

## 5. Order of work
1. `lib/backend-headers.ts`, `lib/safe-next.ts` and `lib/same-origin.ts`.
2. `lib/auth-tokens.ts` (`refreshOnce` with the result cache) and `lib/with-auth-proxy.ts`.
3. The proxy route.
4. The auth routes: login, refresh, logout, change-password.
5. Middleware.
6. The login form, force-change-password form and profile page messages.
7. Run the §4 checks.
