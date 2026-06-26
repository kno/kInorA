# Proposal: 05a V1 Auth Core

## Intent

Implement v1 auth, sessions, UI, and front-side protected-route gating.

## Scope

### In Scope
- Opaque DB bearer sessions.
- Email/password sign-up/login; Google verified-email linking and Google-only verified sign-up.
- Fastify session-extraction decorator: `userId`/`tenantId` for valid sessions; `requireAuth` marker only. API rejection is 05b.
- Auth contracts and framework-free domain rules.
- Web auth pages and `apps/web/src/middleware.ts` redirect to `/login` when no session.
- Mobile auth screens/callback and navigation guard for no-session protected screens.

### Out of Scope
- Tenant switching, password reset, refresh-token rotation, other OAuth providers.
- Email verification beyond async marking.
- API reject policy: 401 missing session, 403 cross-tenant, 422 invalid input — 05b-owned.

## Capabilities

### New Capabilities
- None — same accepted capability.

### Modified Capabilities
- `05a-v1-auth-core`: Google-only verified sign-up creates account, tenant, and passwordless session.

## Approach

Build Fastify + Drizzle credentials, OAuth accounts, and hashed sessions. Use `crypto.scrypt` unless design chooses a KDF. Google OIDC uses PKCE/state and unique-email race handling. 05a provides extraction and front gating; 05b attaches API rejection to `requireAuth`.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/api/src/index.ts` | Modified | Auth routes; session-extraction decorator + `requireAuth`; reject policy deferred. |
| `apps/api/src/db/schema.ts` | Modified | Auth tables. |
| `apps/api/src/tenant/provisioning.ts` | Modified | Provisioning/linking. |
| `packages/{contracts,domain}/src/index.ts` | Modified | Auth DTOs/rules. |
| `apps/web/src/app/(auth)/` | New | Auth pages. |
| `apps/web/src/middleware.ts` | New | No-session protected-route redirect to `/login`. |
| `apps/mobile/` | New | Auth screens/callback; protected-screen guard. |
| `openspec/specs/05a-v1-auth-core/spec.md` | Modified | Needs Google-only sign-up delta. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Google-only sign-up race | Med | Transaction + locked lookup/upsert. |
| Mobile OAuth deep link | Med | Callback tests; redirect allowlist. |
| Seam drift: 05a implements 401/fail-closed | Med | Explicit out-of-scope; design defines decorator contract. |

## Rollback Plan

Remove auth routes/plugins/UI/exports and revert additive migrations.

## Dependencies

- `01c-v1-multi-tenant-schema` — preserve tenant context and active membership invariants.
- Downstream: `05b-v1-security-tenant-validation` depends on 05a. 05a leaves `requireAuth` clean; 05b enforces it.

## Success Criteria

- [ ] Email sign-up creates account, owner tenant, and bearer session.
- [ ] Google-only verified sign-up creates account, owner tenant, and passwordless session.
- [ ] Google links an existing account only when `email_verified=true`.
- [ ] Web sign-up, login, and Google callback screens work.
- [ ] Web middleware redirects unauthenticated users from protected routes to `/login`.
- [ ] Mobile sign-up, login, and Google callback screens work.
- [ ] Mobile guard blocks protected screens when no session.
- [ ] Authenticated routes receive `userId` and `tenantId` from session.
