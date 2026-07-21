# Tasks: Sidebar User Menu — Real Identity + Logout

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~400 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | API logout/profile + web logout action + sidebar real identity | PR 1 | `pnpm -r test` (api + web) | `pnpm dev` → login → sidebar shows real email/initials → click logout → redirect `/login` | Revert PR; dashboard form + FALLBACK_USER remain intact |

## Phase 1: API — AuthService & Routes

- [x] 1.1 RED: Write failing test for `AuthService.getProfile()` returning email + tenantName
- [x] 1.2 GREEN: Add `POST /auth/logout` + `GET /auth/profile` to API routes
- [x] 1.3 RED: Fastify inject: `POST /auth/logout` returns 200 with auth, 401 without
- [x] 1.4 RED: Fastify inject: `GET /auth/profile` returns profile shape, 401 without auth
- [x] 1.5 GREEN: Add `POST /auth/logout` + `GET /auth/profile` to `apps/api/src/routes/auth.ts`

## Phase 2: Web — Profile Client & Server Action

- [x] 2.1 RED: Write failing test for `fetchProfile()` — returns ok/error variants
- [x] 2.2 GREEN: Create `apps/web/src/app/(app)/auth/profile-client.ts`
- [x] 2.3 RED: Write failing test for `logoutServerAction` — calls API, clears cookie, redirects
- [x] 2.4 GREEN: Update `logoutAction` in `dashboard/actions.ts` to call POST /auth/logout

## Phase 3: UI — Sidebar User Area & Prop Threading

- [x] 3.1 RED: SidebarNav with real user: initials, name, logout button, fallback preserved when prop absent
- [x] 3.2 GREEN: `SidebarUser` interface preserved, real data threaded from layout
- [x] 3.3 GREEN: Add logout `<form>` + `<button>` in user area using logoutAction
- [x] 3.4 GREEN: Add `.logoutForm` + `.logoutButton` styles to `SidebarNav.module.css`
- [x] 3.5 GREEN: `AppShell.tsx` — accept `user?: SidebarUser`, forward to `<SidebarNav>`
- [x] 3.6 GREEN: `Apps/web/src/app/(app)/layout.tsx` — fetch profile, build `SidebarUser`, pass as prop

## Phase 4: Cleanup & i18n

- [x] 4.1 Remove logout `<form>` + `logoutAction` import from `apps/web/src/app/(app)/dashboard/page.tsx`
- [x] 4.2 Add `sidebar.logout`, `sidebar.logoutLabel`, `sidebar.userAreaAria` to `en.json` and `es.json`
- [x] 4.3 Verify `pnpm type-check && pnpm test && pnpm architecture && pnpm deps-guard && pnpm build` passes
