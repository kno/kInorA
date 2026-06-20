# Delta for 01a-v1-monorepo-setup

## ADDED Requirements

### Requirement: Mobile-Aware Startup Page

The web app MUST display a visible page on first start that renders without layout breakage on a standard mobile viewport (width ≥ 375px). The page SHALL NOT require PWA installability, service workers, or Capacitor/native shell support.

#### Scenario: Page renders on desktop

- GIVEN the dev server is running
- WHEN a browser requests the web app root URL
- THEN a visible page is returned with content and styling

#### Scenario: Page renders on mobile viewport

- GIVEN the dev server is running
- WHEN a browser with a 375px-wide viewport requests the root URL
- THEN the page does not overflow horizontally or break layout

### Requirement: Capability Guard (Out of Scope)

The baseline MUST NOT include database drivers, authentication, payment processing, AI integrations, Docker images, CI/CD pipelines, PWA capability, or mobile native shell features.

#### Scenario: Audit confirms no unintended dependencies

- GIVEN the workspace is set up
- WHEN a dependency audit runs on `apps/web` and `apps/api`
- THEN no packages for DB, auth, Stripe, AI, Docker, or Capacitor are present

### Requirement: Initial Localization (EN/ES)

The web app MUST support English and Spanish UI copy on startup. Messages SHALL be loaded from structured message files. When no `lang` parameter is present in the URL, the app MUST detect the locale from the browser's `Accept-Language` request header. The `lang` query string parameter, when present, SHALL override header-based detection. English MUST be the fallback locale when the detected or requested language is not supported.

#### Scenario: Language detected from browser headers

- GIVEN a fresh page load with no `lang` parameter
- AND the browser sends `Accept-Language: es`
- WHEN the page renders
- THEN all UI copy appears in Spanish

#### Scenario: English when browser prefers unsupported language

- GIVEN a fresh page load with no `lang` parameter
- AND the browser sends `Accept-Language: fr`
- WHEN the page renders
- THEN all UI copy appears in English

#### Scenario: Query string overrides browser header

- GIVEN a fresh page load
- AND the browser sends `Accept-Language: es`
- WHEN the URL includes `?lang=en`
- THEN all UI copy appears in English

#### Scenario: Unsupported language queried explicitly

- GIVEN a fresh page load
- WHEN the URL includes `?lang=fr`
- THEN the UI falls back to English

## MODIFIED Requirements

### Requirement: Workspace Layout

The project MUST use pnpm workspaces with `apps/web`, `apps/api`, and shared `packages/*` workspaces. All workspace tooling MUST target current stable or LTS versions available at time of implementation.
(Previously: No baseline stack version constraint)

#### Scenario: Fresh install resolves workspaces

- GIVEN a fresh clone
- WHEN `pnpm install` runs at the root
- THEN all declared workspaces resolve without dependency errors

### Requirement: Runnable Development Baseline

The project MUST expose root `pnpm dev`, `pnpm build`, and `pnpm type-check` commands. The `pnpm dev` command MUST start the Next.js web and Fastify API concurrently. The API MUST expose a GET `/health` route returning HTTP 200 with a JSON body.
(Previously: Root dev command only, implicit server choices)

#### Scenario: First development start returns health

- GIVEN dependencies are installed
- WHEN the developer runs `pnpm dev`
- THEN both web and API processes start
- AND GET `/health` returns status 200

#### Scenario: Port conflict on API startup

- GIVEN the configured API port is already in use
- WHEN `pnpm dev` starts
- THEN the API server fails gracefully with a descriptive error message
- AND the web process continues running

