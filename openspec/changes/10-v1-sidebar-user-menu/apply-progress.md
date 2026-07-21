# Apply Progress: Sidebar User Menu

## Status

- Change: `10-v1-sidebar-user-menu`
- Apply state: all_done
- Mode: Standard
- Delivery: one PR with `size:exception`

## Implementation

### API Changes
- Added `POST /auth/logout` endpoint to API auth routes — calls `AuthService.logout(sessionId)` to invalidate the DB session.
- Added `GET /auth/profile` endpoint returning `{ email, initials, tenantName }` — resolves user from the authenticated session via `UserRepository.findById()`.
- Both endpoints gated by `requireAuth()`.

### Web Changes
- Created `apps/web/src/app/(app)/auth/profile-client.ts` — server-only module fetching user profile from the API.
- Updated `logoutAction` in `dashboard/actions.ts` — now calls `POST /auth/logout` (best-effort API invalidation) before clearing the cookie and redirecting.
- Updated `AppLayout` (server component) — reads session cookie, fetches profile, builds `SidebarUser` object, passes it to `<AppShell>`.

### UI Changes
- `AppShell` now accepts an optional `user?: SidebarUser` prop and forwards it to `<SidebarNav>`.
- `SidebarNav` displays the real user identity when the `user` prop is provided (initials circle, email as name, "Free" plan badge). Falls back to `"?" / "Guest"` placeholder when absent.
- SidebarNav now includes a logout button with an SVG icon in the user area, submitting the `logoutAction` form.

### Dashboard Cleanup
- Removed the standalone logout `<form>` and `logoutAction` import from the dashboard page.
- Removed the logout button assertion from dashboard page tests.

### i18n
- Added `sidebar.logout`, `sidebar.logoutLabel`, `sidebar.userAreaAria` to both `en.json` and `es.json`.

## Verification

| Command | Result |
|---------|--------|
| `pnpm --filter web test` | 88 files, 770 tests, all passed |
| `pnpm type-check` | 6 workspace projects passed |
| `pnpm architecture` | 1,562 modules, 4,451 dependencies, both negative probes passed |

## Deviations

- The `SidebarUser` interface was NOT extended with `email` — the existing `name` field is used to display the user's email. Cleaner boundary.
- `AuthService.getProfile()` was not added as a separate method — the profile endpoint uses `UserRepository.findById()` directly in the route handler. The existing `AuthService.logout(sessionId)` is used for the logout endpoint.

## Implemented Files

| File | Action | What |
|------|--------|------|
| `apps/api/src/routes/auth.ts` | Modified | Added POST /auth/logout + GET /auth/profile gated by requireAuth() |
| `apps/api/src/app.ts` | Modified | Pass db to authRoutes for profile endpoint |
| `apps/web/src/app/(app)/auth/profile-client.ts` | Created | Server-only fetchProfile() |
| `apps/web/src/app/(app)/dashboard/actions.ts` | Modified | Updated logoutAction to call POST /auth/logout |
| `apps/web/src/app/(app)/layout.tsx` | Modified | Fetch profile, build SidebarUser, pass to AppShell |
| `apps/web/src/components/AppShell/AppShell.tsx` | Modified | Accept user prop, forward to SidebarNav |
| `apps/web/src/components/AppShell/SidebarNav.tsx` | Modified | Real identity display, logout button |
| `apps/web/src/components/AppShell/SidebarNav.module.css` | Modified | logoutForm, logoutButton styles |
| `apps/web/src/app/(app)/dashboard/page.tsx` | Modified | Remove logout form + import |
| `apps/web/src/app/(app)/__tests__/layout.test.tsx` | Modified | Mock async layout + cookies |
| `apps/web/src/components/AppShell/__tests__/SidebarNav.test.tsx` | Modified | Added logout button test, updated placeholder |
| `apps/web/src/app/(app)/dashboard/__tests__/page.test.tsx` | Modified | Removed logout button assertion |
| `packages/i18n/src/messages/en.json` | Modified | Added sidebar keys |
| `packages/i18n/src/messages/es.json` | Modified | Added sidebar keys |
