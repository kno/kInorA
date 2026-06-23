# Exploration: 05b V1 Security — Tenant Validation & Authorization Defaults

## Current State

### 1. Auth Plugin & requireAuth (`apps/api/src/auth/plugin.ts`)

**How it works today:**
- **Lines 34–35**: `request.authContext` and `reply.authError` are decorated as nullable properties (default `null`)
- **Lines 38–63**: `onRequest` hook extracts `Authorization: Bearer <token>`, hashes via SHA-256, looks up session via `SessionRepository.findByTokenHash`, sets `request.authContext = { userId, tenantId, sessionId }` or leaves it `null` on failure
- **Lines 88–93**: `requireAuth()` returns a `preHandler` that sets `reply.authError = "missing_session"` when `authContext` is null — but does NOT return 401/403, does NOT call `reply.send()`, does NOT throw. This is the deliberate 05a/05b seam.
- **Lines 67–71**: `onSend` hook writes `x-auth-error` header if `reply.authError` is set (observability only, no status code change)
- The plugin uses `Symbol.for("skip-override")` (line 78) so decorators apply globally

**The 401 gap**: `requireAuth` sets a property but does not stop request processing. The request continues to the route handler with a null `authContext`. No hook anywhere inspects `reply.authError` to short-circuit.

### 2. Tenant Context (`apps/api/src/tenant/`)

**How it works today:**
- **`tenant-context.ts`**: Two assertion functions:
  - `assertTenantContext(ctx)` (lines 22–34) — throws if ctx is null/undefined or `tenantId` is empty
  - `assertTenantIdMatchesContext(ctx, id)` (lines 48–61) — calls `assertTenantContext` then checks `id === ctx.tenantId`, throws with `"Tenant context scope mismatch"` on mismatch
- **`repositories.ts`**: `TenantRepository` enforces `TenantQueryContext` on every method:
  - `findTenantById(ctx, id)` (lines 30–40): `assertTenantIdMatchesContext(ctx, id)` then queries by `ctx.tenantId`
  - `findMembershipsByTenant(ctx)` (lines 46–52): `assertTenantContext(ctx)` then queries by `ctx.tenantId`
- **Tenant scope comes from the session**: `request.authContext.tenantId` is populated by the auth plugin at session extraction time (line 59 of plugin.ts: `tenantId: session.tenantId as TenantId`)

**Critical findings:**
- Tenant context enforcement exists at the REPOSITORY LAYER — but ONLY repositories that explicitly receive a `TenantQueryContext` enforce it
- `SessionRepository.findByTokenHash` (session.ts line 42–48) does NOT take a `TenantQueryContext` — it's a PK lookup by hash, which is fine because session lookup must work without tenant context (it's HOW you get tenant context)
- Other repositories (`UserRepository`, `MembershipRepository`, `TenantLookupRepository` in `auth-context.ts`, `CredentialsRepository`, `OauthAccountRepository`, `SocialContextRepository`) — NONE of these take `TenantQueryContext`. They query cross-tenant data (users by email, memberships by user ID, tenants by ID). This is by design for auth flows (login must look up user by email without knowing tenant).
- **NO middleware extracts `request.authContext.tenantId` into a request-scoped `TenantQueryContext`** — every repository method that needs it must receive it explicitly from the caller. Currently no route handler passes it.
- There is NO centralized "ensure every request is scoped" middleware.

### 3. Existing Routes & Validation Schemas

**Complete route inventory (6 endpoints):**

| Route | Method | Schema? | `requireAuth`? | Status |
|-------|--------|---------|----------------|--------|
| `/health` | GET | ❌ (none needed — no body/params/query) | ❌ | Public, static response |
| `/api/health` | GET | ❌ (same) | ❌ | Public, static response |
| `/auth/register` | POST | ✅ Body: `email` (format:email), `password` (minLength:8), `additionalProperties: false` | ❌ | AuthN flow |
| `/auth/login` | POST | ✅ Body: `email` (format:email), `password`, `additionalProperties: false` | ❌ | AuthN flow |
| `/auth/social/login` | GET | ✅ Querystring: `provider` (minLength:1), `additionalProperties: false` | ❌ | AuthN flow |
| `/auth/social/callback` | POST | ✅ Body: `code` (minLength:1), `state` (minLength:1), `additionalProperties: false` | ❌ | AuthN flow |

**Key findings:**
- NO route currently uses `requireAuth` — the preHandler exists but is never applied. Every current endpoint is unauthenticated.
- All auth routes have JSON schemas with `additionalProperties: false` — boundary validation is solid for existing endpoints.
- Health routes need no schema (no input, static `{ status: "ok" }` response).
- The `plan/boundary.ts` file has `assertPlanSpecShape()` — a manual shape validator for PlanSpec — but NO plan routes are registered yet. This is prep for 07-v1-plan-wizard.

### 4. Web Middleware (`apps/web/src/middleware.ts`, `apps/web/src/auth-gate.ts`)

**Current behavior:**
- **`middleware.ts`** (lines 20–36): Reads `SESSION_COOKIE` from `request.cookies`, calls `evaluateAuthGate`, returns `NextResponse.redirect(new URL(result.location))` on result.kind === "redirect", otherwise `NextResponse.next()`.
- Matcher (line 34–36): `["/dashboard/:path*", "/plan/:path*", "/profile/:path*"]`
- **`auth-gate.ts`** (lines 18–33): Pure function. Checks `cookieValue` presence (not validity — just non-empty). No cookie → redirect to `/login?from=<pathname>`. Cookie present → pass.
- **Accept header is NOT checked** — ALL unauthenticated requests to protected routes are redirected, even API/XHR calls.
- Only 2 result kinds: `"pass"` or `"redirect"`. No `"error"` / `"unauthorized"` option.

### 5. Error Handling (`apps/api/src/app.ts`)

**Centralized error handler (lines 28–42):**
- Fastify `validation` property truthy → HTTP 422 `{ error: "Validation Error" }`
- `AuthError` instance → HTTP 401 `{ error: error.message }`
- Everything else → HTTP 500 `{ error: "Internal Server Error" }` (logged)

**Social routes scoped handler (`social.ts` lines 65–80):**
- Fastify `validation` property truthy → HTTP 422
- `SocialAuthError` or `UnknownProviderError` → HTTP 400
- Unknown errors re-thrown to parent handler

**Gaps:**
- No 403 handling exists anywhere
- No mechanism to convert `reply.authError` into an HTTP response — the property is only used for the `x-auth-error` header in the `onSend` hook
- No centralized pre-response check for `reply.authError`

---

## Affected Areas

| File | Why Affected |
|------|-------------|
| `apps/api/src/auth/plugin.ts` | Need to add global 401 enforcement for `reply.authError` |
| `apps/api/src/app.ts` | Need to register the 401 enforcement hook, add 403 error handling |
| `apps/api/src/tenant/tenant-context.ts` | May need `TenantQueryContext` request decorator or extraction helper |
| `apps/api/src/tenant/repositories.ts` | Already compliant — reference for how tenant scoping works |
| `apps/web/src/middleware.ts` | Need to add Accept-header based 401 for API requests |
| `apps/web/src/auth-gate.ts` | Need to add `"unauthorized"` result kind for API/XHR calls |
| `openspec/specs/05b-v1-security-tenant-validation/spec.md` | Target spec — already written |
| `apps/api/src/routes/health.ts` | Should verify no schema needed (it's fine) |

---

## Approaches

### R1: 401 Reject Policy — 3 options

#### 1A. Global preHandler hook (RECOMMENDED)
Add a global `preHandler` or `onRequest` hook in `app.ts` (after `authPlugin` registration) that checks `reply.authError` and returns 401 if set.

- **Pros**: Clean separation — `requireAuth` sets the flag, the global hook enforces it. Zero changes to existing `requireAuth` or route handlers. Easy to test (one hook).
- **Cons**: Need to ensure hook ordering is correct (must run AFTER `authPlugin`'s onRequest, BEFORE route handlers).
- **Effort**: Low

#### 1B. Throw from requireAuth
Change `requireAuth` to throw an `AuthError("missing_session")` when `authContext` is null. The existing error handler already maps `AuthError` → 401.

- **Pros**: Trivial change (3 lines). Reuses existing error handler.
- **Cons**: Breaks the 05a/05b seam. Changes the existing test contract (tests currently expect 200 + `x-auth-error` header, not 401). Not "fail closed" via middleware pattern — it's per-route handler behavior.
- **Effort**: Low, but breaks the seam

#### 1C. New plugin (05b-security plugin)
Create a new `apps/api/src/auth/security-plugin.ts` that registers a global `preHandler` hook to intercept `reply.authError`.

- **Pros**: Cleanest separation of concerns. Testable independently. 05a plugin untouched. Easy to disable.
- **Cons**: One more file to create and register.
- **Effort**: Low-Medium

**Recommendation**: **1A** — global `preHandler` hook in `app.ts` itself. Minimal code, no new file, leverages existing `reply.authError` seam.

---

### R2: Tenant Isolation — 2 options

#### 2A. Request-scoped TenantQueryContext decorator (RECOMMENDED FOR FUTURE)
Add a new Fastify decorator (or a helper function) that extracts `TenantQueryContext` from `request.authContext` and makes it available to route handlers and use cases as `request.tenantCtx`.

- **Pros**: Formalizes the pattern. All downstream code gets tenant scope without manual extraction. Tests can mock it easily.
- **Cons**: Over-engineered for v1 — there are currently NO tenant-scoped resource routes (no plan, workout, or progress endpoints exist yet). These arrive in 07-v1-plan-wizard.
- **Effort**: Low in itself, but the value is primarily in future-proofing.

#### 2B. TenantMiddleware per-route (DEFER)
Add tenant scoping inline when routes are created (e.g., in plan wizard routes). Use the existing `assertTenantContext` and `assertTenantIdMatchesContext` guards at the repository layer, which are already in place.

- **Pros**: No up-front investment. The repository guards already prevent cross-tenant data access. Routes just need to pass `request.authContext.tenantId` through.
- **Cons**: No centralized "this request has tenant scope" check — relies on route authors remembering to pass tenant context.
- **Effort**: None now, deferred to 07

**Recommendation**: **2B** — the repository guards (already implemented in `01c-v1-multi-tenant-schema`) are sufficient for v1. The real enforcement is at the DB query level via `assertTenantIdMatchesContext`. Add a lightweight utility function to extract `TenantQueryContext` from `request.authContext` for use by future routes, but do NOT build a full middleware framework now. This will be needed when resource routes arrive in 07.

---

### R3: Hybrid Web 401/Redirect — 2 options

#### 3A. Accept-header based (RECOMMENDED)
Modify `evaluateAuthGate` to accept `headers` (or at least `accept`) and return `"unauthorized"` when the request appears to be API/XHR (Accept includes `application/json` or custom header like `X-Requested-With: XMLHttpRequest`). The middleware then returns `NextResponse.json({ error: "Unauthorized" }, { status: 401 })`.

- **Pros**: Matches the user's decision (hybrid pattern). Zero extra deps. Works with standard HTTP conventions.
- **Cons**: Minor complexity in `auth-gate.ts`. Need to thread headers through the middleware.
- **Effort**: Low

#### 3B. X-Requested-With header only
Same as 3A but only checks a custom `X-Requested-With: XMLHttpRequest` header instead of Accept.

- **Pros**: More explicit — the client deliberately opts into API mode rather than Accept sniffing.
- **Cons**: Requires the client to set a custom header. Less standard.
- **Effort**: Low

**Recommendation**: **3A** — check `Accept` header contains `application/json` OR check for `X-Requested-With: XMLHttpRequest`. Both are standard conventions, and using both covers more cases.

---

## Recommendation

| Requirement | Approach | Effort |
|-------------|----------|--------|
| 401 Reject (middleware) | 1A — Global preHandler hook in `app.ts` checking `reply.authError` | Low |
| Tenant Isolation | 2B — Defer to repository guards (already in place). Add lightweight `getRequestTenantCtx(request)` utility for future use | Low |
| Boundary Validation | Already compliant for existing routes. Add a test that verifies all registered routes have schemas | Low |
| Web hybrid 401/redirect | 3A — Accept-header detection in `auth-gate.ts` + 401 response in middleware | Low |
| 403 error handling | Add `Error` subclass for 403 + handler in `app.ts` error handler | Low |

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking existing tests: plugin tests expect 200 + `x-auth-error` header, not 401 | Medium | Update test assertions. The existing tests explicitly verify the 05a/05b seam (line 162: "requireAuth must NOT return a 401"). These become the 05b tests. |
| Hook ordering: security hook must run after auth plugin's onRequest | Low | Register the security hook in `app.ts` AFTER `app.register(authPlugin, ...)`. Fastify hooks execute in registration order. |
| Web middleware matcher doesn't include all protected paths | Low | Current matcher (`/dashboard`, `/plan`, `/profile`) is correct for v1. Future routes need to be added. |
| No routes use `requireAuth` yet — 401 enforcement has nothing to trigger on | None | This is expected — 401 enforcement is infrastructure that becomes active when routes start using `requireAuth`. The health endpoint explicitly should NOT require auth. |
| Tenant isolation at repository layer has no test coverage for the enforcement path | Low | Add a test in 05b that verifies `TenantRepository.findTenantById` rejects cross-tenant requests (test already exists in `tenant-context.test.ts` but repository-level integration test is missing) |

## Ready for Proposal

**Yes**. The target spec exists at `openspec/specs/05b-v1-security-tenant-validation/spec.md`. The codebase analysis is complete and the approach for each requirement is clear and low-effort.

The orchestrator should proceed with **sdd-propose** for `05b-v1-security-tenant-validation`. Key messages for the proposal:
- This is a LOW-effort change (small code delta, 100-200 lines estimated)
- No breaking changes to API consumers (no routes are protected yet — the enforcement happens first, then routes opt in)
- The 05a/05b seam is clean — `requireAuth` needs zero changes
- Tests need updating but the changes are additive (new test file for 05b security)
- The web hybrid pattern (redirect vs 401) is the only area needing user-facing decisions on which headers to check
- Tenant isolation is largely done at the repository layer — 05b mainly formalizes the middleware pattern and adds missing tests
