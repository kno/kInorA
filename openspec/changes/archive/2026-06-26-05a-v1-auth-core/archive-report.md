# Archive Report: 05a-v1-auth-core

**Change**: 05a-v1-auth-core — V1 Auth Core
**Archived to**: `openspec/changes/archive/2026-06-26-05a-v1-auth-core/`
**Archive date**: 2026-06-26
**Archive mode**: hybrid (openspec files + Engram)
**SDD cycle**: COMPLETE

---

## Task Completion Gate

- Tasks artifact (Engram obs #1525): ALL 48 tasks marked [x] across 4 PRs
- Task 1.5 (`db:migrate`): reconciled-at-archive — orchestrator-approved stale checkbox. Environment blocker (no local Postgres/Docker), not an implementation gap. Migration SQL verified; apply deferred to host with dev DB.
- No unchecked implementation tasks remain.

---

## Verification Status

| PR | Scope | Result |
|----|-------|--------|
| PR1 | DB schema + contracts + domain | ✅ Verified (prior sessions) |
| PR2 | Auth service + Fastify plugin + email routes | ✅ Verified (prior sessions) |
| PR3 | Social login OIDC + Google + web callback | ✅ Verified (prior sessions) |
| PR4 | Web auth pages + middleware + mobile UI | ✅ PASS WITH WARNINGS (obs #1520, 2026-06-23) |

No CRITICAL issues found in any verification report.

### Carried Forward Warnings (non-blocking)

1. **Next.js 16 middleware deprecation**: `middleware.ts` uses deprecated convention. Build succeeds; middleware functional. Recommend rename to `proxy.ts` in a follow-up change.
2. **deps-guard does not cover `apps/mobile/package.json`**: Mobile workspace not in `WORKSPACE_PACKAGE_FILES`. Benign dependencies (expo, react-navigation, expo-secure-store). Add mobile to deps-guard in follow-up.
3. **PR1 task 1.5 `db:migrate` deferral**: No local Postgres/Docker. Migration SQL verified by inspection; apply pending on a dev host with DB access.

---

## Guard Results (final cumulative)

| Guard | Result |
|-------|--------|
| `pnpm type-check` | ✅ 5/5 workspaces |
| `pnpm -r test` | ✅ 269/269 tests passing |
| `pnpm architecture` | ✅ 628 modules, 1706 deps, 0 violations |
| `pnpm deps-guard` | ✅ (mobile not in guard scope) |
| `pnpm -r build` | ✅ web Next.js build + api tsc |

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `05a-v1-auth-core` | MERGED into main spec | 1 requirement added: "Google-only Sign-up" (2 scenarios) appended to `openspec/specs/05a-v1-auth-core/spec.md`. Prior 3 requirements preserved unchanged. |

### Merge Detail

- **Source (delta)**: `openspec/changes/05a-v1-auth-core/specs/05a-v1-auth-core/spec.md`
- **Target (main)**: `openspec/specs/05a-v1-auth-core/spec.md`
- **Operation**: ADDED requirement "Google-only Sign-up" with 2 scenarios (Google-only sign-up creates account and session; Unverified Google email rejected for new user)
- **Preserved**: Email Authentication, OAuth Account Linking, Session Availability — all untouched

---

## Archive Contents

| File | Status |
|------|--------|
| `proposal.md` | ✅ |
| `exploration.md` | ✅ |
| `specs/05a-v1-auth-core/spec.md` | ✅ |
| `design.md` | ✅ |
| `tasks.md` | ✅ (48/48 tasks [x], task 1.5 reconciled-at-archive) |
| `verify-report-pr4.md` | ✅ |
| `archive-report.md` | ✅ (this file) |

---

## Engram Observation IDs (Traceability)

| Artifact | Observation ID |
|----------|---------------|
| `sdd/05a-v1-auth-core/tasks` | obs #1525 |
| `sdd/05a-v1-auth-core/verify-report` (PR4) | obs #1520 |
| `sdd/05a-v1-auth-core/apply-progress` | obs #1515 |
| `sdd/05a-v1-auth-core/archive-report` (prior) | obs #1526 |
| `sdd/05a-v1-auth-core/archive-report` (this run) | — (see Engram topic `sdd/05a-v1-auth-core/archive-report`) |

Note: proposal, spec, and design artifacts lived on disk only (no separate Engram observations for those artifacts in this change's lifecycle).

---

## Source of Truth Updated

The following spec now reflects the merged behavior:
- `openspec/specs/05a-v1-auth-core/spec.md` — includes Google-only sign-up requirement

---

## Scope Delivered (summary)

- DB schema: `credentials`, `oauth_accounts`, `sessions` tables with Drizzle + migration
- Contracts: `SessionId`, `SessionContext`, `LoginRequest`, `RegisterRequest`, `OidcCallbackParams`, `SessionResponse`
- Domain rules: password policy (scrypt), session invariants
- Auth service: register, login, logout with tenant provisioning
- Fastify plugin: `authContext` decorator, `requireAuth` preHandler
- Auth routes: `POST /auth/register`, `POST /auth/login`
- Social login: OIDC provider registry, Google provider, `GET /auth/social/login`, `POST /auth/social/callback`, web callback proxy
- Web UI: login page, sign-up page, middleware redirect
- Mobile UI: App.tsx navigation, LoginScreen, SignUpScreen, deep-link handler, session guard
- Tests: 269 tests across all workspaces

---

## Source Files to Remove (orchestrator must git rm)

The following source paths must be removed from the active changes directory now that the archive copy is written:

```
openspec/changes/05a-v1-auth-core/proposal.md
openspec/changes/05a-v1-auth-core/exploration.md
openspec/changes/05a-v1-auth-core/specs/05a-v1-auth-core/spec.md
openspec/changes/05a-v1-auth-core/design.md
openspec/changes/05a-v1-auth-core/tasks.md
openspec/changes/05a-v1-auth-core/verify-report-pr4.md
```

The entire folder `openspec/changes/05a-v1-auth-core/` can be removed with:
```
git rm -r openspec/changes/05a-v1-auth-core/
```

---

## SDD Cycle Complete

The change has been fully planned, specified, designed, implemented, verified, and archived.
Ready for the next change.
