## Exploration: 05a-v1-auth-core

### Current State
The accepted auth spec requires email/password registration, Google OAuth account linking by verified email, and session-derived `userId`/`tenantId` for authenticated routes. The current system has no auth implementation yet: `apps/api/src/index.ts` creates a bare Fastify server and only registers `healthRoute`, while `apps/web/src/app/page.tsx` is a static landing page with no auth UI.

The archived `01c-v1-multi-tenant-schema` change provides the tenant foundation that auth must build on. Drizzle/PostgreSQL schema exists in `apps/api/src/db/schema.ts` with `tenants`, `users`, and `memberships`; `users.email` is unique; membership records carry tenant/user association with `owner|member` and `invited|active|suspended`. `apps/api/src/tenant/provisioning.ts` exposes `provisionTenantForUser(db, input)` to create tenant, user, and owner membership transactionally, but it only supports first-time user provisioning and does not handle password credentials, OAuth identities, sessions, or existing-user linking.

Tenant isolation is already a core invariant in `apps/api/src/tenant/tenant-context.ts` and `apps/api/src/tenant/repositories.ts`: repository calls must receive explicit tenant context and reject missing or mismatched tenant scope before persistence. `packages/contracts/src/index.ts` exports stable branded IDs and `TenantQueryContextDTO` without DB imports. Tests are Vitest-based; current API tests cover health routes, tenant schema shape, provisioning, tenant context, and tenant repositories, but there are no auth/session tests.

### Affected Areas
- `openspec/specs/05a-v1-auth-core/spec.md` — accepted requirements for email auth, Google OAuth linking, and session context.
- `openspec/specs/01c-v1-multi-tenant-schema/spec.md` — dependency that defines tenant provisioning handoff and tenant query contract.
- `openspec/changes/archive/2026-06-21-01c-v1-multi-tenant-schema/design.md` — constrains auth to build on API-local Drizzle schema, membership-based tenancy, and explicit tenant context.
- `apps/api/src/index.ts` — Fastify composition root where auth/session plugins and auth routes would be registered.
- `apps/api/src/routes/health.ts` — current route plugin pattern for Fastify routes.
- `apps/api/src/db/schema.ts` — must be extended for password credentials, OAuth accounts, sessions, email verification metadata, or token tables.
- `apps/api/src/db/client.ts` — current Drizzle/PostgreSQL client factory that auth repositories/services will use.
- `apps/api/src/tenant/provisioning.ts` — existing transactional first-user tenant provisioning primitive; likely needs a complementary existing-user link path instead of always inserting a user.
- `apps/api/src/tenant/tenant-context.ts` — existing explicit tenant context assertion that session extraction should produce for authenticated routes.
- `apps/api/src/tenant/repositories.ts` — current tenant-scoped repository pattern and pre-persistence rejection behavior to preserve for auth-dependent tenant lookups.
- `packages/contracts/src/index.ts` — add cross-boundary auth/session DTOs and branded IDs without leaking DB schema or auth library types.
- `packages/domain/src/index.ts` — currently only exports plan domain; add auth domain rules only if they remain framework-free and do not import DB/Fastify/OAuth libraries.
- `apps/api/package.json` — add mature security/auth dependencies such as password hashing, cookie/session/JWT, and OAuth client libraries.
- `apps/api/vitest.config.ts` and `vitest.shared.ts` — existing Vitest/coverage setup for API auth unit tests and possible coverage enforcement.
- `apps/api/src/routes/__tests__/health.test.ts` — demonstrates Fastify `app.inject()` route test pattern to reuse for auth routes/plugins.
- `apps/web/src/app/page.tsx` and `apps/web/src/app/layout.tsx` — current web entry points; sign-up/login UI or route structure would be added around them.
- `apps/web/package.json` — add client-side dependencies only if web auth flow requires them; current web app depends only on Next/React/contracts.
- `apps/api/drizzle/0000_giant_madripoor.sql` — existing migration baseline that auth migrations must extend additively.

### Approaches
1. **API-owned credentials with Argon2id and opaque DB sessions** — Add API-local auth tables (`password_credentials`, `oauth_accounts`, `sessions`), hash passwords with Argon2id via a maintained library, store opaque session tokens hashed in PostgreSQL, and expose session context through a Fastify plugin/decorator.
   - Pros: Revocable sessions; session-to-tenant lookup can enforce membership status; no sensitive tenant/user claims embedded in client-visible tokens; aligns with existing API-local Drizzle boundary.
   - Cons: Requires DB hit or cache for authenticated requests; more schema/repository code; OAuth protocol handling must be implemented carefully.
   - Effort: Medium

2. **API-owned credentials with bcrypt and stateless JWT sessions** — Add password credentials with bcrypt and issue signed JWTs containing `userId` and active `tenantId`; authenticated routes verify JWT and construct tenant context.
   - Pros: Simple request-time verification; fewer DB lookups; common deployment pattern.
   - Cons: Revocation and membership-status changes are harder; tenant context can become stale until token expiry; token theft impact is higher; tenant isolation depends on validating claims against persistence for sensitive operations.
   - Effort: Medium

3. **Delegate auth/session to a framework adapter such as Auth.js** — Use provider/session callbacks to create/link users and expose tenant context, integrating Google and credentials flows through the library.
   - Pros: Mature OAuth/provider handling; less custom protocol code; supports Google OAuth account lifecycle.
   - Cons: The API is Fastify, not Next API routes; adapting Auth.js cleanly may add framework coupling or force session semantics into the web layer; careful boundary design needed to avoid leaking adapter types into contracts/domain.
   - Effort: High

4. **Manual OAuth with `openid-client` plus DB-backed account linking** — Keep auth owned by Fastify API, use a mature OIDC client for Google authorization code + PKCE/state, and link `oauth_accounts` to existing `users` only when Google returns a verified email.
   - Pros: Explicit Fastify fit; verified-email linking rule is easy to make a domain/application invariant; state/PKCE can be tested at the boundary; no Next-specific auth coupling.
   - Cons: More custom flow code than an adapter; must implement callback hardening, state expiry, provider subject uniqueness, and error handling.
   - Effort: Medium

5. **Fastify auth plugin/decorator for session context** — Create an API plugin that parses cookies/authorization, validates session, decorates request with `authSession` or `tenantContext`, and exposes a `requireAuth` preHandler for protected routes.
   - Pros: Centralized deny-by-default route protection; maps directly to Fastify patterns; authenticated handlers receive the exact `userId`/`tenantId` required by the spec; preserves repository explicit-context rules.
   - Cons: Requires TypeScript module augmentation and disciplined route registration; plugin ordering becomes important.
   - Effort: Medium

6. **Per-route session extraction helper** — Each authenticated route calls a shared `resolveSessionContext(request)` helper and passes the resulting tenant context to repositories.
   - Pros: Minimal Fastify plumbing; easy to test as a pure helper.
   - Cons: Easy for future routes to forget; weaker deny-by-default posture; duplicated error handling; less aligned with centralized session availability requirement.
   - Effort: Low

### Recommendation
Use an API-owned auth slice with Argon2id password hashing, Google OIDC via a mature OAuth/OIDC library, database-backed opaque sessions, and a Fastify auth plugin/decorator that exposes `userId` and `tenantId` as request/session context. This fits the existing Fastify + Drizzle architecture, keeps database/auth dependencies inside `apps/api`, supports session revocation and membership-status validation, and preserves the 01c tenant invariant that repository access receives explicit tenant context before persistence.

For email sign-up, create the user/password credential and tenant membership transactionally, reusing or extending `provisionTenantForUser()` where appropriate. For Google OAuth, add a separate link-existing-user path: when Google email is verified and matches `users.email`, insert an OAuth account linked to that user rather than creating a duplicate user; if no user exists, provision user + tenant + membership. Session creation should choose an active tenant explicitly from membership records and store enough server-side metadata to reject suspended or missing memberships before route handlers run.

### Risks
- The current `provisionTenantForUser()` always inserts a new user; OAuth linking by verified email needs an existing-user path and must avoid racing the unique `users.email` constraint.
- No PostgreSQL-backed integration harness exists yet; auth touches uniqueness, transactions, and session persistence where mock-only tests are risky.
- OAuth state, PKCE, nonce, callback URL validation, and verified-email checks must be implemented with a mature library and covered by boundary tests.
- Password hashing must use a maintained library and safe parameters; credentials, tokens, OAuth codes, and secrets must never be logged.
- Stateless JWT sessions would make revocation and tenant membership changes harder; if chosen, sensitive routes still need persistence validation to avoid stale tenant claims.
- Multi-tenant users can have more than one membership; the spec says routes receive a tenant id but does not define active-tenant selection or tenant switching.
- Email verification policy is underspecified for email/password sign-up; the spec requires valid email/password and session creation but does not state whether local email must be verified before session issuance.
- Fastify decoration requires TypeScript module augmentation; missing augmentation or plugin ordering mistakes can weaken route safety.

### Ready for Proposal
Yes — proceed to proposal/design. The orchestrator should clarify active-tenant selection for multi-membership users, whether email/password sign-up requires email verification before issuing a session, and whether the team accepts API-owned OIDC + DB sessions instead of adopting Auth.js.
