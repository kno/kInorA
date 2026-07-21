# Design: Sidebar User Menu — Real Identity + Logout

## Technical Approach

Thread real user identity from the server layout through to the sidebar, add the missing API endpoints for logout and profile, and relocate the logout action from the dashboard page to the sidebar user area. The data path is: `AppLayout` (server) fetches profile via `GET /auth/profile`, builds a `SidebarUser` prop, threads it through `AppShell` → `SidebarNav`. Logout uses a shared Server Action that calls `POST /auth/logout`, clears the cookie, and redirects.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|-----------|
| Profile endpoint on API | `GET /auth/profile` returns `{ email, initials, tenantName }` | Derive from `GET /auth/identity` + separate lookups; inline DB query in route | Single endpoint keeps the web→API boundary clean. `AuthService.getProfile()` reuses existing repo infrastructure. Initials derived server-side to keep client thin. |
| Profile client placement | `apps/web/src/auth/profile-client.ts` (server-only) | Inline in layout; shared util | Follows existing pattern (`dashboard-client.ts`, `plan-draft-client.ts`). Testable with mock fetch. |
| SidebarUser interface | Add `email` field, keep `name` as display (set to email) | Replace `name` with `email` only | Backward-compatible: existing tests and FALLBACK_USER still work. `email` is the source of truth; `name` is display. |
| Logout action location | `apps/web/src/auth/logout.ts` Server Action | Keep in `dashboard/actions.ts`; move to shared `auth/` | Logout must be callable from any authenticated page. Centralizing in `auth/` matches the session-cookie module location. |
| Prop threading model | Server component fetches → client component renders | Client-side fetch via useEffect; React.cache | Server fetch avoids loading skeleton, keeps token server-side, and matches the existing layout pattern (server component wrapping client AppShell). |

## Data Flow

```
AppLayout (server component)
  │
  ├─→ cookies() → kinora_session token
  ├─→ GET {API}/auth/profile (Bearer token) → { email, initials, tenantName }
  ├─→ builds SidebarUser { email, initials, name: email, plan: "Free" }
  └─→ passes user prop to AppShell
        │
        └─→ passes user prop to SidebarNav (client)
              │
              ├─→ renders identity (initials, email, plan)
              └─→ logout button → logoutServerAction (Server Action)
                    │
                    ├─→ POST {API}/auth/logout (Bearer token) → 200
                    ├─→ cookies().set(kinora_session, "", { maxAge: 0 })
                    └─→ redirect("/login")
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/auth/service.ts` | Modify | Add `getProfile(userId, tenantId)` → `{ email, tenantName }` using `userRepo` + `tenantRepo` |
| `apps/api/src/routes/auth.ts` | Modify | Add `POST /auth/logout` (calls `authService.logout(sessionId)`, returns 200) and `GET /auth/profile` (calls `authService.getProfile`, derives initials, returns profile) |
| `apps/web/src/auth/logout.ts` | Create | Shared Server Action: reads token from cookie, calls `POST /auth/logout`, clears cookie, redirects `/login`. Graceful on API failure (still clears cookie). |
| `apps/web/src/auth/profile-client.ts` | Create | Server-only `fetchProfile(token)` → `{ kind: "ok", email, initials, tenantName } | { kind: "error" }`. Pattern mirrors `dashboard-client.ts`. |
| `apps/web/src/app/(app)/layout.tsx` | Modify | Read session cookie, call `fetchProfile`, build `SidebarUser`, pass as prop to `AppShell` |
| `apps/web/src/components/AppShell/AppShell.tsx` | Modify | Accept `user?: SidebarUser` prop, forward to `<SidebarNav user={user} />` |
| `apps/web/src/components/AppShell/SidebarNav.tsx` | Modify | Add `email` to `SidebarUser` interface. Add logout `<form>` with `<button>` in `.userArea`. Use `useFormStatus` or plain submit. |
| `apps/web/src/components/AppShell/SidebarNav.module.css` | Modify | Add `.logoutBtn` styles (subtle, full-width, aligned with user area) |
| `apps/web/src/app/(app)/dashboard/page.tsx` | Modify | Remove `logoutAction` import and `<form action={logoutAction}>` block |
| `packages/i18n/src/messages/en.json` | Modify | Add `sidebar.logout`, `sidebar.logoutLabel`, `sidebar.userAreaAria` |
| `packages/i18n/src/messages/es.json` | Modify | Mirror sidebar keys in Spanish |

## Interfaces / Contracts

```typescript
// API response — GET /auth/profile
interface AuthProfileResponse {
  email: string;
  initials: string;      // email local-part first char, uppercased
  tenantName: string;
}

// Web SidebarUser (apps/web/src/components/AppShell/SidebarNav.tsx)
export interface SidebarUser {
  email: string;
  initials: string;
  name: string;   // display name (set to email)
  plan: string;   // defaults to "Free"
}

// Server-only profile client result
type ProfileResult =
  | { kind: "ok"; email: string; initials: string; tenantName: string }
  | { kind: "error"; message: string };
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (API) | `AuthService.getProfile()` returns email + tenantName for valid userId/tenantId | Mock repositories, assert return shape |
| Unit (API) | `POST /auth/logout` returns 200 and calls `sessionRepo.delete()` | Fastify inject with mock auth context |
| Unit (API) | `GET /auth/profile` returns 200 with profile; 401 without auth | Fastify inject with/without Bearer token |
| Unit (Web) | `SidebarNav` renders real user identity + logout button | `renderToString` with user prop, assert text + form presence |
| Unit (Web) | `SidebarNav` falls back to FALLBACK_USER when no prop | Existing test (keep passing) |
| Unit (Web) | `logoutServerAction` calls API, clears cookie, redirects | Mock `fetch` + `cookies()` + `redirect()` |
| Unit (Web) | `fetchProfile` returns ok/error variants | Mock `fetch`, test both paths |
| Integration | `AppLayout` threads user prop to `AppShell` → `SidebarNav` | Render full layout with mocked profile response |
| i18n | Catalog parity test passes with new sidebar keys | Existing `catalog-parity.test.ts` |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. No schema changes, no data migration. Feature is additive — the fallback behavior is preserved when profile fetch fails.

## Open Questions

- [ ] Should `GET /auth/profile` reuse the existing `GET /auth/identity` endpoint and extend its response, or remain separate? (Design assumes separate for clean separation of concerns.)
- [ ] Plan display: hardcoded `"Free"` now, but the profile endpoint could join with a billing/plans table later. Keep as-is per scope.
