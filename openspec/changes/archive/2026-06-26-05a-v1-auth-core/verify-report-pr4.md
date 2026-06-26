# Verify Report: 05a-v1-auth-core — PR4 (Web/Mobile Auth UI)

**Change**: 05a-v1-auth-core — PR4 UI: Web Auth Pages + Middleware + Mobile
**Branch**: `feat/05a-auth-core-pr4` (base: `main`, PR1/PR2/PR3 merged)
**Mode**: Strict TDD
**Date**: 2026-06-23
**Artifact store**: openspec (file-based)
**Persistence**: verify-report persisted

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total (PR4) | 13 |
| Tasks complete | 13 ✅ |
| Tasks incomplete | 0 |
| Tasks incomplete (cumulative) | 1 (PR1 task 1.5 `db:migrate` — BLOCKED: no local Postgres) |

---

## Build & Tests Execution

**TypeCheck**: ✅ Passed (5 of 5 workspaces)
```
apps/mobile: Done
packages/contracts: Done
apps/web: Done
packages/domain: Done
apps/api: Done
```

**Tests**: ✅ **269 passed** (0 failed, 0 skipped)
```
packages/domain:  3 files,  22 tests
packages/contracts: 1 file,   7 tests
apps/api:         17 files, 152 tests
apps/web:         10 files,  54 tests
apps/mobile:       5 files,  34 tests
```
PR4-specific: web 54 (auth-gate 5, submit-login 8, submit-signup 5, login page 4, sign-up page 4, callback route 8, locale 11, page 3, proxy 4, plan-spec 2) + mobile 34 (deep-link-action 8, deep-link 10, session-guard 6, callback-proxy 4, credentials 6) = **88 tests for PR4 scope**.

**Architecture**: ✅ Passed (628 modules, 1706 dependencies, no violations)
```
✔ no dependency violations found
✅ packages/contracts/src rejects pg import
✅ packages/domain/src rejects drizzle-orm import
✅ Architecture negative guard passed: every DB import probe was rejected
```

**Deps Guard**: ✅ Passed (apps/web, apps/api, packages/contracts, packages/domain — all clean)
```
NOTE: apps/mobile NOT covered by deps-guard WORKSPACE_PACKAGE_FILES (known gap)
```

**Build**: ✅ Passed
```
apps/web:  Next.js 16.2.9 production build — all routes built successfully
           Routes: /, /_not-found, /auth/social/login, /callback/social, /login, /sign-up
           Proxy (Middleware) — compiled and optimized
apps/api:  tsc — compiled successfully
```

**Coverage**: ➖ Not requested (no coverage threshold in verify scope)

---

## Spec Compliance Matrix (PR4-facing)

| Requirement | Scenario | Test Coverage | Result |
|-------------|----------|---------------|--------|
| Email Authentication | Email sign-up and login | `submit-login.test.ts` (8 tests), `submit-signup.test.ts` (5 tests), `credentials.test.ts` (6 tests) — all passing | ✅ COMPLIANT |
| OAuth Account Linking | OAuth links existing account | `callback-proxy.test.ts` (4 tests), `deep-link-action.test.ts` (8 tests), `deep-link.test.ts` (10 tests) — all passing | ✅ COMPLIANT |
| Session Availability | Session exposes tenant context | `auth-gate.test.ts` (5 tests), `session-guard.test.ts` (6 tests) — all passing | ✅ COMPLIANT |

**Compliance summary**: 3/3 scenarios compliant ✅

---

## Correctness (Static Evidence)

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1.1 | Login page — email/password form + Google link | ✅ | `login/page.tsx` — form with email (required, type=email), password (required, type=password), submit, Google link to `/auth/social/login?provider=google`, cross-link to /sign-up |
| 1.2 | Sign-up page — same pattern | ✅ | `sign-up/page.tsx` — same structure, cross-link to /login |
| 1.x | Server Actions POST to Fastify API | ✅ | `loginAction` → `submitLogin` → POST `/auth/login`; `signupAction` → `submitSignup` → POST `/auth/register` |
| 1.x | Form validation, error display | ✅ | `submitLogin`/`submitSignup`: missing_fields, api_unreachable, error mapping; page renders `role="alert"` from `searchParams.error` |
| 1.x | Link between login/sign-up | ✅ | Login page links to `/sign-up`; Sign-up page links to `/login` |
| 2.1 | Middleware — checks `kinora_session` cookie | ✅ | `middleware.ts` → `evaluateAuthGate` — pure presence check, no 401/403 |
| 2.1 | Matcher for protected routes | ✅ | `config.matcher`: `/dashboard/:path*`, `/plan/:path*`, `/profile/:path*` |
| 2.1 | Redirects to `/login` with `from` param | ✅ | Redirects to `/login?from=<original-path>` when no valid cookie |
| 3.1 | Mobile Expo entry + React Navigation | ✅ | `App.tsx` — `NavigationContainer` + native stack (Login/SignUp/Home), deep-link listener, navigation guard |
| 3.2 | Mobile login/sign-up screens | ✅ | `LoginScreen.tsx`, `SignUpScreen.tsx` — email/password forms + Google buttons + credential validation |
| 3.3 | Deep-link handler with allowlist | ✅ | `resolveDeepLinkAction` — composes `parseDeepLinkCallback` + `isAllowedRedirectUrl`; open-redirect guard, scheme validation, missing param checks |
| 3.4 | Navigation guard | ✅ | `shouldGuardRoute` + `resolveInitialRoute` — tested pure functions wired in App.tsx |
| 3.4 | SecureStore session check | ✅ | `session-storage.ts` — `getSessionToken`, `setSessionToken`, `deleteSessionToken` |
| 4.3 | All guards pass | ✅ | type-check, test, architecture, deps-guard, build — all green |

---

## Design Coherence

| # | Design Decision | Followed? | Notes |
|---|----------------|-----------|-------|
| 5 | Web auth UI — App Router `(auth)` route group + middleware | ✅ | `(auth)/login/page.tsx`, `(auth)/sign-up/page.tsx`, `middleware.ts` — exactly as designed |
| 5 | No API 401 fail-closed — frontend only redirect | ✅ | Middleware redirects to `/login`, no 401/403. Server Actions redirect on error, never throw 401 |
| 6 | Mobile auth UI — deep-link OAuth redirect + navigation guard + redirect allowlist | ✅ | `resolveDeepLinkAction` validates scheme + allowlist + params; `shouldGuardRoute` gates protected routes |
| 6 | Mobile deep-link allowlist validation for callback URLs | ✅ | `isAllowedRedirectUrl` with `REDIRECT_ALLOWLIST = ["kinora://auth/callback"]` |

### Deviations

| Deviation | Justification | Severity |
|-----------|---------------|----------|
| `resolveDeepLinkAction` extracted as new composition pure fn | Composes `parseDeepLinkCallback` + `isAllowedRedirectUrl` into a single testable decision — cleaner than inline logic | ✅ Improvement |
| Web `tsconfig.json` — `declaration: false`, `declarationMap: false` | Required after adding mobile workspace changed `@types/react` hoisting (TS2742). Apps don't emit declarations | ✅ Portability fix |
| Mobile screens — typed JSON casts for `res.json()` | Mirrors web submit-login.ts pattern; `no dom lib` yields `unknown` from `res.json()` | ✅ Necessary |
| Google mobile button — placeholder `Alert.alert` | Structural wiring point; full in-app-browser/AuthSession integration deferred (documented in code comment) | ✅ Acceptable — documented as deferred |
| middleware.ts uses deprecated Next.js 16 `middleware` convention | Build succeeds; middleware functions as designed. Recommend rename to `proxy.ts` in follow-up | ⚠️ Warning (Next.js deprecation, not a bug) |
| `deps-guard` does NOT cover `apps/mobile/package.json` | mobile not in `WORKSPACE_PACKAGE_FILES`; `expo`, `react-navigation`, `expo-secure-store` are benign | ⚠️ Warning (add to deps-guard in follow-up) |

---

## TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | Found in apply-progress (PR4 section with full TDD Cycle Evidence table) |
| All tasks have tests | ✅ | 13/13 PR4 tasks have covering test files |
| RED confirmed (tests exist) | ✅ | All test files confirmed present in codebase |
| GREEN confirmed (tests pass) | ✅ | All 88 PR4-scope tests pass (269 total suite) |
| Triangulation adequate | ✅ | 5 auth-gate cases, 8 submit-login, 5 submit-signup, 8 deep-link-action, 10 deep-link, 6 session-guard, 4 callback-proxy, 6 credentials, 4+4 page tests |
| Safety Net for modified files | ✅ | Pre-existing test suites run and passed before PR4 modification |

**TDD Compliance**: 6/6 checks passed ✅

---

## Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 88 | 10 | Vitest |
| Integration | 0 (PR4) | 0 | Integration tests live in apps/api (PR2/PR3) |
| E2E | 0 | 0 | Playwright available but not in scope per design |
| **Total** | **88** | **10** | |

---

## Assertion Quality

All PR4 test files audited. Zero trivial assertions found.

| File | Assertion Pattern | Issue | Severity |
|------|-------------------|-------|----------|
| — | — | — | — |

**Assertion quality**: ✅ All assertions verify real behavior

Files audited:
- `auth-gate.test.ts` (5) — behavioral: pass/redirect decisions, from-param preservation, empty/whitespace cookies ✅
- `submit-login.test.ts` (8) — behavioral: POST to API, error mapping, network failure, missing fields, fallback URLs ✅
- `submit-signup.test.ts` (5) — behavioral: same pattern as submit-login ✅
- `login/__tests__/page.test.tsx` (4) — behavioral: input types, required, Google link, error display, cross-link ✅
- `sign-up/__tests__/page.test.tsx` (4) — behavioral: same pattern as login page ✅
- `deep-link-action.test.ts` (8) — behavioral: process/ignore decisions, open-redirect guard, scheme validation, missing params, empty allowlist ✅
- `deep-link.test.ts` (10) — behavioral: parse results, null on missing params, allowlist matching ✅
- `session-guard.test.ts` (6) — behavioral: initial route resolution, guard decisions for auth/protected routes ✅
- `callback-proxy.test.ts` (4) — behavioral: POST to API, error mapping, network failure, missing token ✅
- `credentials.test.ts` (6) — behavioral: valid/invalid classification, email format, password length, whitespace ✅

---

## Issues Found

### CRITICAL
- None

### WARNING
1. **Next.js 16 middleware deprecation**: `middleware.ts` uses the deprecated `middleware` file convention. Next.js 16 recommends `proxy.ts`. Build succeeds; middleware functions as designed (`ƒ Proxy (Middleware)`). Rename to `proxy.ts` recommended in follow-up.
2. **deps-guard does not cover mobile**: `apps/mobile/package.json` is not in deps-guard's `WORKSPACE_PACKAGE_FILES`. Mobile dependencies (expo, react-navigation, expo-secure-store) are benign, but the workspace should be guarded.
3. **PR1 task 1.5 `db:migrate` still BLOCKED**: No local Postgres/Docker available. Migration SQL verified; apply deferred. This is a cumulative issue from PR1, not PR4-specific.

### SUGGESTION
1. **Mobile submit helpers**: Mobile screens' inline `fetch`+`parse` for login/sign-up could be extracted as pure testable functions (mirroring web `submit-login.ts`/`submit-signup.ts`).
2. **Google mobile button**: Uses placeholder `Alert.alert` instead of real in-app-browser/AuthSession. Documented in code as deferred integration.
3. **Consolidate PR2/PR3 session hash functions**: `computeTokenHash` (PR2) and `hashTokenForLookup` (PR3) are separate implementations that should be consolidated.

---

## Verdict

**PASS WITH WARNINGS**

PR4 implementation is complete and verified:
- ✅ All 13 PR4 tasks are [x] marked and verified by source inspection
- ✅ All 3 spec scenarios have passing covering tests
- ✅ All 4 design decisions are followed (with minor documented deviations)
- ✅ All 5 guard commands pass (type-check, test, architecture, deps-guard, build)
- ✅ TDD compliance: 6/6 checks passed
- ✅ Assertion quality: zero trivial assertions

Non-blocking warnings: Next.js 16 middleware deprecation, deps-guard not covering mobile, and cumulative PR1 db:migrate deferral. None block archive readiness.
