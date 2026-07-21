## Exploration: Sidebar User Menu — Real Identity + Logout

### Current State

**Logout position**: The logout button lives at the bottom of `apps/web/src/app/(app)/dashboard/page.tsx` (line 179–183) as a `<form action={logoutAction}>` with a "Log out" button. It's only reachable from the dashboard route, not from any other authenticated page.

**Logout implementation**: `logoutAction` in `dashboard/actions.ts` clears the `kinora_session` cookie and redirects to `/login`. It does NOT call the API to invalidate the DB session — the comment on line 13–14 says "A proper API-backed logout that also invalidates the DB session can be added when the `POST /auth/logout` endpoint is wired to the web app." There is currently NO `POST /auth/logout` endpoint on the API (`apps/api/src/routes/auth.ts` only registers `/auth/register`, `/auth/login`, and `GET /auth/identity`).

**Sidebar user area**: `SidebarNav` (client component) already has a `SidebarUser` interface (`initials`, `name`, `plan`) and renders a user area at the bottom with avatar (initials circle), user name, and plan badge. However, it uses `FALLBACK_USER` (`{ initials: "JD", name: "User", plan: "Free" }`) because the `user` prop is optional and NEVER passed — `AppShell` renders `<SidebarNav />` without any props.

**Data chain**: `AppLayout` (server component) → `AppShell` (client component) → `SidebarNav` (client component). `AppShell` is `"use client"` and manages viewport detection. The `user` prop exists in `SidebarNav`'s API but is never supplied.

**Available user data**: The `users` schema (`apps/api/src/db/schema.ts`) has only `id`, `email`, `isAdmin`, `createdAt`, `updatedAt` — no `name` or `displayName` field. The `SessionResponse` from login/register includes `user: { id, email }` and `tenant: { id, name }`. The `GET /auth/identity` endpoint returns `{ tenantId, userId }` — no email or name.

**i18n**: `dashboard.logout` key already exists in both `en.json` ("Log out") and `es.json` ("Cerrar sesión"). No sidebar-specific logout key exists yet.

**Mobile**: `MobileNav` has no user area or logout — logout on mobile remains unresolved in scope.

### Affected Areas

- `apps/web/src/components/AppShell/SidebarNav.tsx` — Add logout button in user area, use real user data (remove `FALLBACK_USER` usage)
- `apps/web/src/components/AppShell/SidebarNav.module.css` — Add styles for the logout button in the user area
- `apps/web/src/components/AppShell/AppShell.tsx` — Accept and forward `user` prop to `SidebarNav`
- `apps/web/src/app/(app)/layout.tsx` — Fetch user data and pass it to `AppShell`
- `apps/web/src/app/(app)/dashboard/page.tsx` — Remove the logout form at the bottom
- `apps/web/src/app/(app)/dashboard/actions.ts` — `logoutAction` needs to move to a shared module or inline in sidebar
- `apps/web/src/auth/session-cookie.ts` — Possibly re-export logout utility from here or new `/auth` module
- `apps/api/src/routes/auth.ts` — Add `POST /auth/logout` endpoint that calls `AuthService.logout()`
- `apps/api/src/auth/service.ts` — Already has `logout(sessionId)` method (deletes session by token hash)
- `apps/web/src/i18n/messages/en.json` — Add `sidebar.logout` / `sidebar.logoutLabel` / `sidebar.userAreaAria` keys
- `apps/web/src/i18n/messages/es.json` — Mirror new keys
- `apps/web/src/components/AppShell/__tests__/AppShell.test.tsx` — Update tests for prop forwarding

### Approaches

1. **Thread user data from server layout through AppShell** — `AppLayout` (server component) calls the API to get user info, passes it as a serializable prop to `AppShell`, which forwards to `SidebarNav`. Add a shared logout Server Action. Wire `POST /auth/logout` API call before clearing cookie.
   - Pros: No client-side fetch for identity; user data available on SSR; clean prop chain; real API logout invalidates DB session
   - Cons: Requires one additional API call on every authenticated page load; threading props through two components adds some boilerplate
   - Effort: Low/Medium

2. **Client-side fetch in SidebarNav** — Accept the session token as a prop and fetch user data client-side inside `SidebarNav`.
   - Pros: No prop threading through `AppShell`; `AppLayout` stays unchanged
   - Cons: Client-side fetch waterfall; flash of fallback content before fetch completes; SSR gets placeholder
   - Effort: Low

3. **Server Action for identity only** — Create a `getUserProfileAction()` Server Action, call it from `AppLayout`, pass result as prop.
   - Pros: Same as #1 but keeps the fetch pattern consistent with other Server Actions
   - Cons: Adds another Server Action to the codebase; essentially the same as #1 with more indirection
   - Effort: Low/Medium

### Recommendation

**Approach 1** — Thread user data from the server layout. The data path is:

1. Add `POST /auth/logout` on the API (AuthService.logout already exists, just needs the route).
2. Add `GET /auth/profile` endpoint returning `{ email, initials, tenantName }` (or enhance `GET /auth/identity`).
3. Create a shared `auth/logout.ts` Server Action that calls `POST /auth/logout` with the session token, then clears the cookie and redirects.
4. In `AppLayout`, call a `getUserProfileAction()` Server Action (or direct fetch via server-only client) to resolve user info from the session cookie.
5. Thread the result as `user: SidebarUser` through `AppShell` to `SidebarNav`.
6. In `SidebarNav`, replace `FALLBACK_USER` with the real `user` prop, add a logout button/form in the user area.
7. Remove the logout form from `dashboard/page.tsx`.

Since the `users` table has no `name` field, derive initials from the email local part (first character, uppercase). Display the email as the user name. The `plan` field can default to "Free" until billing is implemented.

This approach gives us proper server-side session invalidation while keeping the sidebar consistent and accessible from all authenticated pages.

### Risks

- **Email-derived initials are minimal identity**: Until the users table has a `name` field, the sidebar only shows email + first-char initial. This is functional but not personalized.
- **Additional API call per page load**: Every authenticated layout render calls `GET /auth/profile`. This could be mitigated with request-level caching or React cache(), but adds latency on cold pages.
- **API endpoint surface increase**: Adding `POST /auth/logout` and possibly `GET /auth/profile` expands the auth route surface. Must ensure both are properly auth-gated.
- **Mobile logout not addressed**: The mobile nav has no user area. Scope explicitly excludes mobile for now — the dashboard form removal leaves mobile users without a visible logout until the mobile route-group or `MobileNav` is updated separately.
- **SidebarNav tests**: Currently no covering tests for `SidebarNav`. New behavior (logout interaction, real user display) should have tests.

### Ready for Proposal

Yes — full analysis is complete. The orchestrator should tell the user:
- This is a clean, contained change with clear boundaries.
- Two API endpoints needed (`POST /auth/logout` + `GET /auth/profile`), but the service layer already has `logout()`.
- The data prop chain (`AppLayout` → `AppShell` → `SidebarNav`) is well-defined and the `SidebarUser` interface already exists.
- Escope mobile logout as a separate concern to keep this change focused.
- Estimated effort: ~1 day of implementation for the full chain including TDD.
