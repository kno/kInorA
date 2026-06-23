# Proposal: 05b-v1-security-tenant-validation

## Intent

05a-v1-auth-core completed with a deliberate seam: `requireAuth` sets `reply.authError` but does NOT return 401. This change closes that gap — enforcing authentication rejection, adding a lightweight tenant isolation utility for future use, and handling web hybrid 401/redirect behavior. Without this, authenticated routes have no enforcement layer.

## Scope

### In Scope

- **Global 401 rejection middleware**: `preHandler` hook in the auth plugin that reads `reply.authError` and returns 401 for ALL `requireAuth` endpoints
- **Tenant isolation utility**: Extract `TenantQueryContext` from `request.authContext` for use by repository-layer tenant guards
- **Web hybrid 401/redirect**: Accept-header detection — redirect to `/login` for HTML navigation, return 401 for API/XHR calls

### Out of Scope

- No new routes or endpoints
- No subdomain-based tenant validation
- No new validation framework (existing Fastify JSON schema per-route is sufficient)
- No changes to existing route schemas (boundary validation is already solid)
- No tenant creation, provisioning, or management UI

## Capabilities

### New Capabilities

- `security-auth-enforcement`: Global 401 rejection for unauthenticated access, hybrid web redirect/401 behavior

### Modified Capabilities

None — this is additive middleware, not a change to existing spec requirements.

## Approach

1. **Auth plugin `preHandler` hook** (cleanest seam per exploration): Register a global `preHandler` in the auth plugin that checks `reply.authError` — if set, return 401 with `{ error: "unauthorized" }`. This avoids breaking the existing `requireAuth` pattern.
2. **`extractTenantQueryContext` utility**: Pure function that derives `TenantQueryContext` from `request.authContext`. Lightweight, no framework coupling. Future routes can call this before passing to repository guards.
3. **Web `middleware.ts` update**: Add Accept-header check in the existing middleware. HTML requests → redirect `/login`; API/XHR requests → 401 JSON response.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Existing unauthenticated routes accidentally blocked | Low | Only endpoints using `requireAuth` are affected; current routes have no auth requirement |
| Accept-header check too aggressive for some clients | Low | Only HTML page navigations redirect; all other requests get 401 |
| Tenant utility unused until new routes added | Low | Intentional future-proofing; zero runtime cost |

## Success Criteria

- [ ] `requireAuth` endpoints return 401 without a valid session
- [ ] HTML page navigation to protected routes redirects to `/login`
- [ ] API/XHR requests to protected routes return 401 JSON
- [ ] Existing unauthenticated routes (health, register, login) remain unaffected
- [ ] `extractTenantQueryContext` utility compiles and is importable
- [ ] All existing tests pass unchanged
