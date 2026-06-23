# Tasks: 05a V1 Auth Core

**STRICT TDD MODE IS ACTIVE** (config.yaml `tdd: true` + sdd-init). Test runner: `pnpm -r test`. Write failing test (RED) → make it pass (GREEN) → add Triangle edge cases. Do NOT fall back to Standard Mode.

Password hashing: `crypto.scrypt` (zero-dep Node built-in). Sessions: opaque `randomBytes(32)` hex tokens, hashed in DB for lookup. Social login: `openid-client` provider-agnostic OIDC, Google first. 05a/05b seam: `requireAuth` is presence check only — no 401/403 reject policy.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,400–1,600 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | force-chained |
| Chain strategy | stacked-to-main |

```
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | DB schema + contracts + domain rules + session infrastructure | PR 1 | Base = main. Foundation other slices depend on. |
| 2 | Auth service + Fastify auth plugin + email register/login routes | PR 2 | Base = main. Combines core business logic with API wiring. |
| 3 | OIDC provider abstraction + Google provider + social login routes + web callback | PR 3 | Base = main. Depends on PR 1 schema, independent from PR 2 (can merge in parallel). |
| 4 | Web auth pages + middleware redirect + mobile auth screens | PR 4 | Base = main. Depends on PR 2/3 routes existing. |

## PR 1 — Foundation: Schema, Contracts, Domain, Session Infrastructure

### Phase 1: Database Schema

- [x] [PR1][DB] 1.1 Add `credentials` table to `apps/api/src/db/schema.ts` — `userId`, `passwordHash`, `createdAt`. FK to `users`. unique index on `userId`.
- [x] [PR1][DB] 1.2 Add `oauth_accounts` table — `providerId`, `providerAccountId`, `email`, `userId` (nullable FK), `createdAt`. Unique indexes: `(providerId, providerAccountId)`, `(providerId, email)`. Used for race-safe linking.
- [x] [PR1][DB] 1.3 Add `sessions` table — `tokenHash` (unique), `userId` (FK), `tenantId` (FK), `createdAt`, `expiresAt`. unique index on `tokenHash`.

### Phase 1.5: Database Migration

- [x] [PR1][DB] 1.4 Generate Drizzle migration: run `pnpm db:generate` (drizzle-kit generate) from `apps/api/` after schema changes. Verify a new migration SQL file appears in `apps/api/drizzle/` with `CREATE TABLE` statements for `credentials`, `oauth_accounts`, and `sessions` including the unique indexes and FKs.
- [x] [PR1][DB] 1.5 Run `pnpm db:migrate` against the local dev database to apply the new auth migration. Verify no errors and that the migration is recorded in the `__drizzle_migrations` table. (BLOCKED: no local Postgres/Docker available in this environment; migration SQL verified, apply deferred to a host with the dev DB running. reconciled-at-archive: orchestrator-approved stale checkbox — environment blocker, not implementation gap.)

### Phase 2: Contracts & Domain Rules

- [x] [PR1][CTR] 2.1 Add auth DTOs to `packages/contracts/src/index.ts`: `SessionId` branded type, `SessionContext`, `LoginRequest`, `RegisterRequest`, `OidcCallbackParams`, `SessionResponse`.
- [x] [PR1][DOM] 2.2 Add password policy rules to `packages/domain/src/auth/password.ts` — min length (8), hash with `crypto.scrypt` verify/compute. Export from `packages/domain/src/index.ts`.
- [x] [PR1][DOM] 2.3 Add session invariants to `packages/domain/src/auth/session.ts` — token entropy check (32 bytes hex = 64 chars), expiry validation. Export from `packages/domain/src/index.ts`.

### Phase 3: Session Infrastructure

- [x] [PR1][API] 3.1 Create `apps/api/src/auth/session.ts` — `generateToken()` (randomBytes(32) → hex), `hashToken(token)` (crypto.scrypt), `verifyToken(token, hash)`.
- [x] [PR1][API] 3.2 Create `apps/api/src/db/repositories/session.ts` — Drizzle queries for session CRUD: `findByTokenHash`, `create`, `delete`, `deleteByUserId`.

### Phase 4: Testing

- [x] [PR1][TST] 4.1 RED: Write failing tests for password hashing policy (min length, hash/verify roundtrip, wrong password rejected, empty/invalid input). GREEN: Implement `packages/domain/src/auth/password.ts`. Triangle: empty string, very long input, special chars.
- [x] [PR1][TST] 4.2 RED: Write failing tests for session invariants (token format, expiry validation). GREEN: Implement `packages/domain/src/auth/session.ts`. Triangle: malformed token, expired timestamp, null edge.
- [x] [PR1][TST] 4.3 Test session repository with in-memory Drizzle — `findByTokenHash` returns session, `create` inserts row, `delete` removes, not-found returns null.
- [x] [PR1][TST] 4.4 Verify `pnpm type-check` + `pnpm architecture` + `pnpm deps-guard` pass across all affected workspaces.

## PR 2 — Core Auth: Service, Plugin, Email Routes

### Phase 1: Auth Service

- [x] [PR2][API] 1.1 Create `apps/api/src/auth/service.ts` — `register(input: RegisterRequest)` → provisions tenant + creates credentials + creates session + returns token. Uses `provisionTenantForUser` from tenant/provisioning.ts.
- [x] [PR2][API] 1.2 Add `login(input: LoginRequest)` — verifies password against hash in credentials table, creates session, returns token.
- [x] [PR2][API] 1.3 Add `logout(sessionId)` — deletes session from DB.

### Phase 2: Fastify Plugin

- [x] [PR2][API] 2.1 Create `apps/api/src/auth/plugin.ts` — Fastify plugin that adds `request.authContext` decorator: extracts `Authorization: Bearer <token>`, hashes token, looks up session + user + membership. Sets `request.authContext: SessionContext | null`.
- [x] [PR2][API] 2.2 Add `requireAuth` preHandler to `plugin.ts` — checks `authContext` is non-null, sets `reply.authError = 'missing_session'` but does NOT return 401 (05b owns reject policy).

### Phase 3: Auth Routes

- [x] [PR2][API] 3.1 Create `apps/api/src/routes/auth.ts` — Fastify plugin with `POST /auth/register` (body: RegisterRequest) and `POST /auth/login` (body: LoginRequest). Each returns `SessionResponse`.
- [x] [PR2][API] 3.2 Register auth plugin + auth routes in `apps/api/src/index.ts`.

### Phase 4: Testing

- [x] [PR2][TST] 4.1 RED: Write failing tests for auth service register (new account creates tenant + credentials + session). GREEN: Implement register. Triangle: duplicate email rejected, invalid password format, missing fields.
- [x] [PR2][TST] 4.2 RED: Write failing tests for auth service login (valid credentials return session, wrong password rejected). GREEN: Implement login. Triangle: wrong password, unknown email, account with no credentials (social-only).
- [x] [PR2][TST] 4.3 Integration test: `POST /auth/register` via `app.inject()` returns 200 with `SessionResponse` + token. `POST /auth/login` with valid creds returns session. Missing fields return 422.
- [x] [PR2][TST] 4.4 Integration test: session extraction plugin — valid bearer token sets `request.authContext`, missing token sets null, invalid token sets null. `requireAuth` preHandler marks error but does NOT return 401.
- [x] [PR2][TST] 4.5 Verify `pnpm type-check` + `pnpm test` + `pnpm architecture` + `pnpm deps-guard` pass.

## PR 3 — Social Login: OIDC + Google + Routes + Web Callback

### Phase 1: OIDC Provider Infrastructure

- [x] [PR3][API] 1.1 Create `apps/api/src/auth/providers.ts` — OIDC provider registry: interface `OidcProvider { getAuthorizationUrl(params): string; exchangeCode(code, state): ProviderUser }`. Configurable per provider via env vars. Register providers at startup.
- [x] [PR3][API] 1.2 Add `openid-client` to `apps/api/package.json`.
- [x] [PR3][API] 1.3 Implement Google OIDC provider — reads issuer metadata from `https://accounts.google.com/.well-known/openid-configuration`, validates `email_verified === true`, returns `{ providerId: 'google', providerAccountId, email, emailVerified }`.

### Phase 2: Social Login Routes

- [x] [PR3][API] 2.1 Add `GET /auth/social/login?provider=google` — initiates OIDC flow, returns authorization URL with PKCE + state.
- [x] [PR3][API] 2.2 Add `POST /auth/social/callback` — exchanges code for tokens, validates `email_verified`, handles linking: existing user by email → link OAuth account (transactional locked lookup/upsert with unique indexes). New verified user → provision tenant + create oauth_account + session (Google-only sign-up). Unverified email → error.

### Phase 3: Web OIDC Callback Proxy

- [x] [PR3][WEB] 3.1 Create `apps/web/src/app/(auth)/callback/social/route.ts` — Next.js route handler that captures OIDC callback params (code, state), proxies to `POST /auth/social/callback`. On success, redirects to app home. On error, redirects to login with error param.

### Phase 4: Tenant Provisioning Update

- [x] [PR3][API] 4.1 Modify `apps/api/src/tenant/provisioning.ts` — add `linkOauthToExistingUser(db, userId, providerId, providerAccountId, email)` for the OAuth linking case (does not create new user/tenant, only links).

### Phase 5: Testing

- [x] [PR3][TST] 5.1 RED: Write failing tests for OIDC provider registry + Google provider (mock OIDC issuer). GREEN: Implement. Triangle: unverified email rejected, missing email in claims, unknown provider id.
- [x] [PR3][TST] 5.2 RED: Write failing tests for social callback — new Google user creates account + session, existing user links OAuth account. GREEN: Implement. Triangle: unverified email rejected, race condition on concurrent callback, provider mismatch.
- [x] [PR3][TST] 5.3 Integration test: `POST /auth/social/callback` via `app.inject()` with mocked OIDC exchange. Verify session returned for new users, linking for existing. Verify unverified email returns error.
- [x] [PR3][TST] 5.4 Test web callback proxy handler — valid code/state proxies to API, missing params return error redirect.
- [x] [PR3][TST] 5.5 Verify `pnpm type-check` + `pnpm test` + `pnpm architecture` + `pnpm deps-guard` pass.

## PR 4 — UI: Web Auth Pages + Middleware + Mobile

### Phase 1: Web Auth Pages

- [x] [PR4][WEB] 1.1 Create `apps/web/src/app/(auth)/login/page.tsx` — email/password login form + "Sign in with Google" button. On success redirects to app home.
- [x] [PR4][WEB] 1.2 Create `apps/web/src/app/(auth)/sign-up/page.tsx` — email/password sign-up form + "Sign up with Google" button. On success redirects to app home.

### Phase 2: Web Middleware

- [x] [PR4][WEB] 2.1 Create `apps/web/src/middleware.ts` — checks for session cookie/token on protected routes (path-based matcher), redirects to `/login` when no session detected. Uses `request.authContext` presence only (no 401/403 — 05b owns that).

### Phase 3: Mobile Auth

- [x] [PR4][MOB] 3.1 Initialize `apps/mobile/` with Expo project structure + navigation setup.
- [x] [PR4][MOB] 3.2 Create mobile login and sign-up screens — email/password forms + Google Sign-In button using Google Sign-In SDK.
- [x] [PR4][MOB] 3.3 Create mobile OAuth deep-link handler with redirect allowlist validation — receives `code` + `state`, proxies to `POST /auth/social/callback`, stores session token, navigates to home.
- [x] [PR4][MOB] 3.4 Create mobile navigation guard — checks for stored session token, redirects unauthenticated users to login screen.

### Phase 4: Testing

- [x] [PR4][TST] 4.1 Test web auth pages render correctly with Vitest (Next.js testing utilities).
- [x] [PR4][TST] 4.2 Test web middleware redirect — authenticated user passes through, unauthenticated user redirected to `/login`.
- [x] [PR4][TST] 4.3 Verify `pnpm type-check` + `pnpm test` + `pnpm architecture` + `pnpm deps-guard` pass across all workspaces.
