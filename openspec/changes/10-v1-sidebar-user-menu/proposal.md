# Proposal: Sidebar User Menu — Real Identity + Logout

## Intent

Logout is trapped inside the dashboard page. Users cannot log out from any other authenticated route. The sidebar shows a hardcoded fallback user (`JD / User / Free`) despite the `SidebarUser` prop being defined but never supplied. This change moves logout to the sidebar user area, threads real user data from the server layout, and adds the missing API endpoints (`POST /auth/logout`, `GET /auth/profile`) to properly invalidate DB sessions.

## Scope

### In Scope
- `POST /auth/logout` API endpoint — calls `AuthService.logout()` (already implemented) and invalidates the DB session
- `GET /auth/profile` API endpoint — returns `{ email, initials, tenantName }` derived from the session
- Shared `auth/logout.ts` Server Action — calls `POST /auth/logout`, clears the cookie, redirects to `/login`
- Thread `user: SidebarUser` from `AppLayout` → `AppShell` → `SidebarNav` via props
- Add logout button in `SidebarNav` user area with proper form submission
- Remove the logout form from `dashboard/page.tsx`
- Derive initials from email local part (no `name` field in users table); display email as user name; plan defaults to "Free"
- i18n keys for sidebar logout (`sidebar.logout`, `sidebar.logoutLabel`, `sidebar.userAreaAria`) in both `en.json` and `es.json`

### Out of Scope
- Mobile logout (MobileNav has no user area — separate concern)
- User name/display name field on the users table
- Billing plan display in sidebar (defaults to "Free")
- Request-level caching of profile data (optimize later)

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `05a-v1-auth-core`: Add `POST /auth/logout` endpoint (DB session invalidation) and `GET /auth/profile` endpoint (user identity + tenant name retrieval)
- `06b-v1-orbit-ui-shell`: Sidebar user area now shows real user data and a logout button; user prop threading from server layout to client sidebar

## Approach

Thread user data from the server layout. Data path:

1. Add `POST /auth/logout` route → `AuthService.logout()` (service already has the method)
2. Add `GET /auth/profile` route → returns `{ email, initials, tenantName }` from session
3. Create shared `apps/web/src/auth/logout.ts` Server Action — calls API logout, clears cookie, redirects
4. `AppLayout` (server) fetches profile via server-only client, passes `user: SidebarUser` as prop
5. `AppShell` accepts and forwards the `user` prop to `SidebarNav`
6. `SidebarNav` replaces `FALLBACK_USER` with real `user`, renders logout button/form in user area
7. Remove logout `<form>` from `dashboard/page.tsx`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/routes/auth.ts` | Modified | Add `POST /auth/logout` and `GET /auth/profile` |
| `apps/web/src/auth/logout.ts` | New | Shared logout Server Action |
| `apps/web/src/app/(app)/layout.tsx` | Modified | Fetch user profile, thread prop to AppShell |
| `apps/web/src/components/AppShell/AppShell.tsx` | Modified | Accept and forward `user` prop |
| `apps/web/src/components/AppShell/SidebarNav.tsx` | Modified | Replace FALLBACK_USER, add logout button |
| `apps/web/src/components/AppShell/SidebarNav.module.css` | Modified | Styles for logout button in user area |
| `apps/web/src/app/(app)/dashboard/page.tsx` | Modified | Remove logout form |
| `apps/web/src/i18n/messages/en.json` | Modified | Add sidebar logout keys |
| `apps/web/src/i18n/messages/es.json` | Modified | Mirror sidebar logout keys |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Email-derived initials feel impersonal | Low | Temporary — name field is a separate future spec |
| Additional API call per page load | Low | One lightweight endpoint; add `React.cache()` if latency matters |
| Mobile users lose dashboard logout without replacement | Med | Out of scope; document as known gap, fast-follow with MobileNav |
| Auth-gating not enforced on new endpoints | Low | Both routes go through existing auth middleware |

## Rollback Plan

Revert the commit. The dashboard logout form and `FALLBACK_USER` remain as-is. No data migration or schema changes involved.

## Dependencies

- `05a-v1-auth-core` spec (auth middleware, `AuthService.logout()` already exists)

## Success Criteria

- [ ] `POST /auth/logout` invalidates DB session and clears the cookie
- [ ] `GET /auth/profile` returns correct email, initials, and tenant name
- [ ] Sidebar shows real user email and initials on all authenticated pages
- [ ] Logout button in sidebar clears session and redirects to `/login`
- [ ] Dashboard page no longer contains a logout form
- [ ] All `pnpm type-check`, `pnpm test`, `pnpm architecture`, `pnpm deps-guard`, `pnpm build` pass
- [ ] Catalog parity test passes (new i18n keys in both languages)
