# Design: 05b-v1-security-tenant-validation

## Technical Approach

Three focused changes to the API and Web delivery layers. All are additive middleware — no domain, schema, or route changes.

1. **Global 401 Enforcement** — Add a `preHandler` hook in `apps/api/src/auth/plugin.ts` that checks `reply.authError` and returns HTTP 401 with `{ error: "unauthorized" }`. The existing `onSend` hook continues to set `x-auth-error` header for observability.
2. **Tenant Isolation Utility** — Add `extractTenantQueryContext` to `apps/api/src/tenant/tenant-context.ts`. Pure function, zero framework coupling. Future routes call this to derive `TenantQueryContext` from `request.authContext` before passing to repository guards.
3. **Web Hybrid Middleware** — Update `apps/web/src/middleware.ts` to detect `Accept: application/json` or `x-requested-with: XMLHttpRequest` headers. API/XHR → 401 JSON; HTML navigation → redirect to `/login?from=`.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Where to enforce 401 | `preHandler` hook in auth plugin vs throw from `requireAuth` vs new security plugin | Hook: clean seam, additive, no import chain changes. Throw: breaks 05a seam. New plugin: unnecessary indirection. | **preHandler in auth plugin** |
| Tenant utility placement | New file vs extend `tenant-context.ts` | New file: overkill for one function. Extend: existing file already owns `TenantQueryContext` and assertions. | **Extend `tenant-context.ts`** |
| Web 401 detection | `Accept` header vs `x-requested-with` vs both | `Accept`: standard but some clients send `*/*`. `x-requested-with`: jQuery-specific. Both: broadest coverage with no false positives. | **Both headers** |
| 401 response shape | `{ error: "unauthorized" }` vs `{ message: "..." }` vs generic | `{ error }` matches existing API error convention. | **`{ error: "unauthorized" }`** |

## Data Flow

```
Browser request ──→ Next.js middleware ──→ evaluateAuthGate()
     │                                        │
     │                                  has session? ──Yes──→ pass
     │                                        │
     │                                       No
     │                                        │
     │                              Accept: text/html? ──Yes──→ redirect /login
     │                                        │
     │                                       No → 401 JSON

API request ──→ authPlugin.onRequest ──→ session extraction
     │                                       │
     │                              set request.authContext
     │                                       │
     │                              route preHandler (requireAuth)
     │                                       │
     │                              set reply.authError? ──No──→ handler runs
     │                                       │
     │                                      Yes
     │                                       │
     │                              global preHandler ──→ reply.authError set?
     │                                       │              Yes → 401 JSON
     │                                       │              No  → handler runs
     │                                       │
     │                              authPlugin.onSend ──→ set x-auth-error header
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/auth/plugin.ts` | Modify | Add global `preHandler` hook: if `reply.authError` is set and response not sent → `reply.code(401).send({ error: "unauthorized" })` |
| `apps/api/src/auth/__tests__/plugin.test.ts` | Modify | Update requireAuth tests: expect 401 + JSON body instead of 200 + `x-auth-error` header |
| `apps/api/src/tenant/tenant-context.ts` | Modify | Add `extractTenantQueryContext(request)` utility function |
| `apps/api/src/tenant/__tests__/tenant-context.test.ts` | Modify | Add tests for `extractTenantQueryContext` |
| `apps/web/src/middleware.ts` | Modify | Add `Accept`/`x-requested-with` header detection; return 401 JSON for API/XHR requests |
| `apps/web/src/__tests__/auth-gate.test.ts` | Modify | Add tests for hybrid 401/redirect behavior based on headers |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (API) | `preHandler` returns 401 when `authError` set | Fastify inject with mock DB, no auth header, route using `requireAuth` |
| Unit (API) | `preHandler` passes through when no `authError` | Fastify inject with valid token |
| Unit (API) | `extractTenantQueryContext` extracts correct fields | Direct function call with mock `authContext` |
| Unit (API) | `extractTenantQueryContext` throws on null | Direct function call with null |
| Unit (Web) | Hybrid redirect/401 based on Accept header | `evaluateAuthGate` extended or middleware-level mock |
| Integration | Protected route returns 401 without session | Full server test with `requireAuth` route |

## Migration / Rollout

No migration required. All changes are additive middleware — no data, schema, or route changes. The existing `x-auth-error` header continues to be set by the `onSend` hook for observability during rollout.

## Open Questions

None — all decisions resolved per user input.
