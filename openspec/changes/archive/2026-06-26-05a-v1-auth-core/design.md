# Design: 05a V1 Auth Core

## Technical Approach

API-owned Fastify + Drizzle auth slice with three new tables (`credentials`, `oauth_accounts`, `sessions`), opaque DB-backed bearer sessions, provider-agnostic OIDC social login (Google first implementation) with PKCE/state, and `crypto.scrypt` (zero-dependency Node built-in). 05a owns session extraction and `requireAuth` presence check; 05b owns 401/403 reject policy. Web adds auth pages + middleware redirect. Mobile adds auth screens + navigation guard.

## Architecture Decisions

| # | Decision | Choice | Alternatives | Rationale |
|---|----------|--------|--------------|-----------|
| 1 | **Password hashing KDF** | Node `crypto.scrypt` (zero-dep) | `@node-rs/argon2`, `bcrypt` | User rejected Argon2id over lib maintenance concerns. scrypt is OWASP memory-hard, Node core maintained, zero external deps. |
| 2 | **Session strategy** | Opaque DB-backed bearer (`randomBytes(32)` hex, hashed in DB) | Stateless JWT, Auth.js sessions | Revocable; membership status validated per request; enables mobile bearer pattern. JWT makes revocation and stale tenant claims harder. |
| 3 | **Social login design** | Provider-agnostic OIDC abstraction (`openid-client`) with PKCE + state. Google is the first implementation; Apple, GitHub, etc. are additive config entries. | Auth.js, per-provider hardcoded flows | `oauth_accounts` schema is generic (`provider_id`, `provider_account_id`) — adding a provider means a config entry + OIDC issuer metadata, not flow changes. Link accounts by verified email; BLOCK when `email_verified` is not `true`. |
| 4 | **05a/05b seam** | 05a: `request.authContext: SessionContext \| null` + `requireAuth` preHandler (presence only). 05b: 401/403 error response semantics. | 05a implements full 401/403 | Clean boundary — 05a provides the hook, 05b enforces the policy. Avoids duplication. |
| 5 | **Web auth UI** | `apps/web/src/app/(auth)/` route group + `middleware.ts` for protected-route redirect to `/login` | Server components only, Auth.js adapter | App Router convention; middleware is the standard Next.js gating pattern. No API 401 fail-closed — frontend only. |
| 6 | **Mobile auth UI** | `apps/mobile/` (to be created) with deep-link OAuth redirect + navigation guard + redirect allowlist for callback URLs | Embedded webview, Expo AuthSession | Explicit native screens; deep-link for OAuth callback with allowlist validation. Callback tests verify accepted/rejected redirect URLs. Framework TBD (see Open Questions). |

## Data Flow

```
Registration:
  User ──POST /auth/register──→ Fastify ──→ scrypt hash ──→ Drizzle INSERT (users, credentials, memberships, sessions) ──→ Bearer token response

Login:
  User ──POST /auth/login──→ Fastify ──→ scrypt verify ──→ Drizzle SELECT (credentials) ──→ Session INSERT ──→ Bearer token response

Social login OIDC:
  Provider abstraction layer — each provider (Google first) registers OIDC issuer metadata + client config.
  Google example:
    Web/Mobile ──GET /auth/social/login?provider=google──→ Provider Auth URL redirect
    │
    ├─ Web: Google ──→ /callback/social/route.ts ──POST /auth/social/callback──→ API code exchange
    ├─ Mobile: Google Sign-In SDK ──→ code ──POST /auth/social/callback──→ API code exchange
    │
    API callback ──→ verify PKCE + id_token ──→ email_verified? ──→ link/create user ──→ Session ──→ token

Authenticated request:
  Client ──Authorization: Bearer <token>──→ Fastify auth plugin ──→ hash token ──→ Drizzle SELECT (sessions + users + memberships) ──→ request.authContext {userId, tenantId, sessionId}
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | Modify | Add `credentials`, `oauth_accounts`, `sessions` tables. `oauth_accounts`: `uniqueIndex(provider_id, provider_account_id)`, `uniqueIndex(provider_id, email)`. `sessions`: `uniqueIndex(token_hash)`. Transactional locked lookup/upsert for OAuth linking to prevent race on `users.email`. |
| `apps/api/src/tenant/provisioning.ts` | Modify | Add existing-user link branch for OAuth linking |
| `apps/api/src/index.ts` | Modify | Register auth plugin + auth routes |
| `apps/api/src/routes/auth.ts` | Create | Auth route plugin (register, login, social login endpoints) |
| `apps/api/src/auth/plugin.ts` | Create | Fastify plugin: session extraction decorator + `requireAuth` preHandler |
| `apps/api/src/auth/service.ts` | Create | Auth business logic (password hash/verify, OIDC provider abstraction, session CRUD) |
| `apps/api/src/auth/session.ts` | Create | Session token generation, hash, verification |
| `apps/api/src/auth/providers.ts` | Create | OIDC provider registry — configurable per provider (Google first, Apple/GitHub/etc additive) |
| `packages/contracts/src/index.ts` | Modify | Add auth DTOs (LoginRequest, RegisterRequest, SessionContext, SocialLoginRequest, etc.) |
| `packages/domain/src/index.ts` | Modify | Add framework-free auth rules (password policy, session invariants, provider config validation) |
| `apps/web/src/app/(auth)/login/page.tsx` | Create | Login page |
| `apps/web/src/app/(auth)/sign-up/page.tsx` | Create | Sign-up page |
| `apps/web/src/app/(auth)/callback/social/route.ts` | Create | Social login OIDC callback handler — proxy to API (provider-agnostic) |
| `apps/web/src/middleware.ts` | Create | Protected-route redirect to `/login` |
| `apps/mobile/` | Create | App structure + auth screens + navigation guard |
| `apps/api/package.json` | Modify | Add `openid-client` dependency |

## Interfaces / Contracts

```typescript
// packages/contracts/src/index.ts
export type SessionId = Brand<string, 'SessionId'>;

export interface SessionContext {
  userId: UserId;
  tenantId: TenantId;
  sessionId: SessionId;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface GoogleOidcCallbackParams {
  code: string;
  state: string;
}

export interface SessionResponse {
  token: string;
  user: { id: UserId; email: string };
  tenant: { id: TenantId; name: string };
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (domain) | Password policy, session invariants, email+tenant validation | Vitest pure function tests; RED→GREEN→Triangle |
| Unit (api) | Auth service (hash/verify, session CRUD, OIDC linking logic) | Vitest with mocked Drizzle/repositories |
| Integration | Auth routes (register, login, Google callback) | Vitest with `app.inject()` + in-memory DB |
| Integration | Session extraction plugin + `requireAuth` preHandler | Vitest with `app.inject()` + valid/invalid/missing bearer tokens |
| Web | Auth pages render, middleware redirect | Vitest (Next.js testing utilities) |
| E2E | Full sign-up → session → protected route → logout | Playwright (future, not in scope for this design) |

## Migration / Rollout

No migration required. Auth tables are additive; schema extends via Drizzle migrations. No data to migrate.

## Open Questions

- [x] OIDC callback routing: resolved — web callback proxies code to `POST /auth/google/callback`, API owns code exchange + session creation. Mobile SDK sends code to same endpoint.
- [x] OIDC library: resolved — `openid-client` (mature, Fastify-native PKCE/state handling).
- [x] OAuth account race prevention: resolved — `uniqueIndex(provider_id, provider_account_id)` and `uniqueIndex(provider_id, email)` on `oauth_accounts`; transactional locked lookup/upsert in auth service.
- [x] sessionId branded type: resolved — `SessionId = Brand<string, 'SessionId'>` in contracts.
- [x] Mobile deep-link allowlist: resolved — redirect URL allowlist validation + callback tests.
- [ ] Session cleanup / expiry strategy: TTL-based deletion job or explicit logout + stale cleanup?
- [ ] Password policy rules (min length, complexity) — define in domain rules before implementation.
- [ ] Mobile: React Native or Expo? No existing mobile tooling detected. Recommend Expo for faster onboarding.
