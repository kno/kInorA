# Delta for 10-v1-sidebar-user-menu

Applies to `05a-v1-auth-core` (new API endpoints) and `06b-v1-orbit-ui-shell` (sidebar user area + logout).

## ADDED Requirements

### Requirement: Auth Logout Endpoint

The system MUST provide `POST /auth/logout` that calls `AuthService.logout(sessionId)` and SHALL return 200. Auth-gated via `requireAuth()`.

#### Scenario: Logout invalidates DB session

- GIVEN an authenticated user with a valid session
- WHEN they POST /auth/logout
- THEN the session is deleted and 200 is returned

#### Scenario: Logout without auth returns 401

- GIVEN no valid session token
- WHEN POST /auth/logout is called
- THEN a 401 response is returned

### Requirement: Auth Profile Endpoint

The system MUST provide `GET /auth/profile` returning `{ email, initials, tenantName }`. `initials` SHALL derive from the email local-part first character, uppercased. Auth-gated via `requireAuth()`.

#### Scenario: Profile returns user identity

- GIVEN an authenticated user with email "alice@example.com"
- WHEN GET /auth/profile is called
- THEN 200 returns `{ email: "alice@example.com", initials: "A", tenantName: "..." }`

#### Scenario: Profile without auth returns 401

- GIVEN no valid session token
- WHEN GET /auth/profile is called
- THEN 401 is returned

### Requirement: Sidebar User Area with Real Identity

The sidebar user area MUST display the authenticated user's email and derived initials instead of `FALLBACK_USER`. The `user: SidebarUser` prop SHALL be threaded from `AppLayout` → `AppShell` → `SidebarNav`. `plan` SHALL default to `"Free"`.

#### Scenario: Sidebar shows real user identity

- GIVEN an authenticated user with profile data
- WHEN the app shell renders on desktop
- THEN the sidebar user area shows the user's email and initials

#### Scenario: Fallback renders when user prop is absent

- GIVEN no user prop is provided to SidebarNav
- WHEN the sidebar renders
- THEN it shows the FALLBACK_USER placeholder (existing behavior preserved)

### Requirement: Sidebar Logout Action

The sidebar user area MUST include a logout button calling a shared Server Action. The action SHALL call `POST /auth/logout`, clear the `kinora_session` cookie, and redirect to `/login`.

#### Scenario: Logout from sidebar clears session

- GIVEN an authenticated user viewing the sidebar
- WHEN they click logout
- THEN POST /auth/logout is called, the cookie is cleared, and they redirect to /login

#### Scenario: Logout API failure is handled gracefully

- GIVEN the API returns an error during logout
- WHEN the user clicks logout
- THEN the cookie is still cleared and they redirect to /login

### Requirement: Sidebar i18n Labels

Sidebar logout MUST use translatable labels. System SHALL include keys `sidebar.logout`, `sidebar.logoutLabel`, and `sidebar.userAreaAria` in both `en.json` and `es.json`.

#### Scenario: Logout label renders in current locale

- GIVEN an authenticated user viewing the sidebar
- WHEN the locale is English
- THEN the logout button shows text from the `sidebar.logout` key

#### Scenario: Catalog parity is maintained

- GIVEN the i18n catalogs
- WHEN checking key parity
- THEN all sidebar keys exist with matching placeholders in both languages

---

## MODIFIED Requirements

### Requirement: Responsive App Shell and Navigation

Authenticated app surfaces MUST share a responsive shell with desktop sidebar and mobile bottom navigation. The sidebar SHALL include a user area at the bottom showing the authenticated user's identity and a logout button.
(Previously: Sidebar had no user identity or logout)

#### Scenario: Desktop navigation exposes primary areas *(unchanged)*

- GIVEN an authenticated user on a desktop viewport
- WHEN the app shell renders
- THEN sidebar navigation exposes dashboard, plan, statistics, and plan creation destinations

#### Scenario: Mobile navigation exposes primary areas *(unchanged)*

- GIVEN an authenticated user on a mobile viewport
- WHEN the app shell renders
- THEN bottom navigation exposes the main mobile destinations with accessible hit targets

---

## REMOVED Requirements

### Requirement: Dashboard Logout Form

The logout `<form action={logoutAction}>` from `dashboard/page.tsx` SHALL be removed.

(Reason: Logout is now in the sidebar area accessible from all authenticated pages.)
(Migration: Remove the form and `logoutAction` import from `dashboard/page.tsx`. `logoutAction` moves to `apps/web/src/auth/logout.ts`.)
