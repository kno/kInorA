# Tasks: 05b-v1-security-tenant-validation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~100–200 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | Single PR |

## Phase 1: Global 401 Enforcement

- [x] [05b][API] 1.1 Add global `preHandler` hook in `apps/api/src/auth/plugin.ts` — checks `reply.authError`, returns 401 with `{ error: "unauthorized" }` if set and response not yet sent. Preserve existing `onSend` hook.
- [x] [05b][TST] 1.2 Update `apps/api/src/auth/__tests__/plugin.test.ts` — change `requireAuth` assertions from 200 + `x-auth-error` header to 401 + JSON body. Add test: passes through when no `authError` set.

## Phase 2: Tenant Isolation Utility

- [x] [05b][API] 2.1 Add `extractTenantQueryContext(request)` to `apps/api/src/tenant/tenant-context.ts` — extracts `TenantQueryContext` from `request.authContext`. Throws if `authContext` is null.
- [x] [05b][TST] 2.2 Add tests in `apps/api/src/tenant/__tests__/tenant-context.test.ts` — correct extraction with valid `authContext`, throws on null.

## Phase 3: Web Hybrid Middleware

- [x] [05b][WEB] 3.1 Update `apps/web/src/middleware.ts` — detect `Accept: application/json` or `x-requested-with: XMLHttpRequest` headers. API/XHR → 401 JSON response. HTML navigation → redirect to `/login?from=` (existing behavior).
- [x] [05b][TST] 3.2 Add tests in `apps/web/src/__tests__/auth-gate.test.ts` — hybrid redirect/401 for HTML requests, API requests, and fallback scenarios.

## Phase 4: Verification

- [x] [05b][TST] 4.1 Run full guard suite: `pnpm type-check`, `pnpm test`, `pnpm architecture`, `pnpm deps-guard`, `pnpm build`.
