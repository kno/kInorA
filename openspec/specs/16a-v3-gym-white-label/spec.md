# 16a-v3-gym-white-label Specification

## Purpose

Provide white-label branding for gym tenants through configurable logo, colors, and domain identity.

## Dependencies

- `15b-v2-trainer-dashboard-branding`
- `01c-v1-multi-tenant-schema`
- `05b-v1-security-tenant-validation`
- `11a-v1-billing-plans-tiers`

## Requirements

### Requirement: Gym Branding Configuration

A gym-tier tenant MUST be able to configure its branding — a full palette
(`accent`, `accentFg`, `surface`, `surface2`, `fg`, `muted`, each
`^#[0-9a-fA-F]{6}$`) plus an uploaded logo — through authenticated CRUD routes
gated by `assertGymEntitled` (billing tier `!== "gym"` → `ForbiddenOwnerAccess`,
flat 403). Each tenant MUST have at most one branding row, keyed by a unique
`subdomainSlug`.

#### Scenario: Gym owner configures branding

- GIVEN a tenant on the `gym` billing tier
- WHEN its owner submits a full palette and a logo via the branding CRUD route
- THEN the branding row is created/updated and returned with the new values

#### Scenario: Non-gym tenant denied branding CRUD

- GIVEN a tenant whose billing tier is not `gym`
- WHEN any user in that tenant calls a branding CRUD or logo-upload route
- THEN `assertGymEntitled` throws and the response is a flat 403 with no write

#### Scenario: Invalid hex color rejected

- GIVEN a gym-tier owner submits a palette field not matching `^#[0-9a-fA-F]{6}$`
- WHEN the branding update is validated
- THEN the response is HTTP 400 and no row is persisted or updated

### Requirement: Default Branding Fallback

Every themed surface (login page, root layout) MUST render CSS custom
properties as `var(--gym-x, var(--default))`, so any tenant with no branding
row, or a request resolving to an unknown/absent subdomain slug, renders
default kInorA tokens with no server error and no client-side branching.

#### Scenario: No branding configured falls back

- GIVEN a tenant has no `tenant_branding` row
- WHEN a member of that tenant loads any themed screen
- THEN default kInorA tokens render via the CSS `var()` fallback

#### Scenario: Unknown subdomain falls back

- GIVEN a request host resolves to a slug with no matching `tenant_branding` row
- WHEN the login page requests branding by that slug
- THEN the public endpoint returns not-found and the login page renders default tokens

### Requirement: Branding Tenant Isolation

Every branding read and write MUST be scoped by `tenantId`. Gym owners MUST be
able to read/write only their own tenant's branding row; the PUBLIC
read-by-slug endpoint MUST return only the fields of the tenant matching that
slug (`logoUrl`, `palette`) and MUST NEVER return another tenant's data or any
PII.

#### Scenario: Cross-tenant branding write denied

- GIVEN gym A and gym B are both `gym`-tier tenants with distinct branding
- WHEN a gym A owner attempts to write branding using gym B's `tenantId`
- THEN the write is rejected and gym B's branding row is unchanged

#### Scenario: Cross-tenant branding read excluded

- GIVEN gym A and gym B have different branding configured
- WHEN a gym A member requests branding through the authenticated route
- THEN only gym A's branding is returned; gym B's data never appears

#### Scenario: Public read never leaks cross-tenant data or PII

- GIVEN a public request for `GET /public/branding/by-slug/:slug` matching gym A
- WHEN the response is returned
- THEN it contains only gym A's `logoUrl` and `palette`, no PII, and no gym B data

### Requirement: Logo Upload via Storage Abstraction

Logo upload MUST go through an `ObjectStoragePort` abstraction (`put/get/delete`)
gated by `assertGymEntitled`. The system MUST reject uploads whose content-type
is outside the allowlist (`png`, `jpeg`, `svg`, `webp`) or that exceed the
configured size cap, and MUST NOT persist a storage key or update the branding
row for a rejected upload. Accepted uploads MUST be served via a stable URL.

#### Scenario: Valid logo accepted

- GIVEN a gym-tier owner uploads a `png` logo under the size cap
- WHEN the upload completes
- THEN the storage adapter persists it and the branding row's logo URL updates

#### Scenario: Invalid content-type rejected

- GIVEN a gym-tier owner uploads a file with a disallowed content-type
- WHEN the upload route validates it
- THEN the upload is rejected, no storage key is written, and branding is unchanged

#### Scenario: Oversized logo rejected

- GIVEN a gym-tier owner uploads a file exceeding the configured size cap
- WHEN the upload route validates it
- THEN the upload is rejected, no storage key is written, and branding is unchanged

### Requirement: Public Subdomain Branding Resolution

The login page MUST resolve the request host to a `subdomainSlug` server-side
and fetch that tenant's branding via a PUBLIC, unauthenticated, read-only,
tenant-scoped endpoint. A slug with no matching tenant MUST resolve to the
default-branding case, never an error page.

#### Scenario: Known slug resolves gym branding

- GIVEN a request host `gymname.kinora.aitsai.com` maps to a configured gym tenant
- WHEN the login page loads
- THEN it fetches and renders that tenant's logo and palette pre-authentication

#### Scenario: Unknown slug resolves to default

- GIVEN a request host maps to no known `subdomainSlug`
- WHEN the login page loads
- THEN it renders default kInorA branding with no server error

### Requirement: Whole-App Rebrand After Login

After a member authenticates, the root layout MUST inject that member's
active-tenant branding as CSS custom properties (inline `<style>`) so every
screen in the app renders in the tenant's palette, with the same
`var(--gym-x, var(--default))` fallback used pre-auth.

#### Scenario: Member sees tenant branding app-wide

- GIVEN a member's active tenant has branding configured
- WHEN they log in and navigate the app
- THEN every screen renders using that tenant's palette via the root layout injection

## Non-Goals

- Custom domains (`app.somegym.com`) — subdomain-only in this change.
- Per-member theme overrides; theming for non-gym tenants.
- Admin UI for assigning the `gym` tier or `subdomainSlug` (provisioning is API-only).
- Reverse-proxy/DNS wildcard routing — external infra prerequisite, out of repo scope.
