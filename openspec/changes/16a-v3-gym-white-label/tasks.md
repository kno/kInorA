# Tasks: Gym White-Label Branding (16a, v3)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1750-2100 total (S1 ~250, S2 ~450, S3 ~500, S4 ~350, S5 ~200) |
| 400-line budget risk | Low against the 800-line budget per slice; S3 (~500) is the only slice that could brush the 400-line *soft* convention alone but stays well under the 800-line hard budget |
| Chained PRs recommended | Yes — 5 chained PRs, one per slice, matching the design's dependency order |
| Suggested split | PR1 (S1) → PR2 (S2) → PR3 (S3) → PR4 (S4) → PR5 (S5) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main (each slice merges before the next starts, mirroring 15a) |

Decision needed before apply: No — all 5 slices fit individually and cumulatively
inside the 800-line review budget; no slice needs further splitting.

### Slice boundaries — ordering / dependency rationale

| Slice | Goal | Independently shippable? | Depends on |
|-------|------|---------------------------|------------|
| S1 | `tenant_branding` schema + `"gym"` tier + contracts | Yes (schema/contracts only, dark — no route reads it yet) | — |
| S2 | `ObjectStoragePort` + `LocalStorageAdapter` + upload/serve routes | Partially — routes exist but are unreachable without S3's gating wired to real branding rows; storage code itself is independently testable | S1 (needs `"gym"` tier + table for the entitlement gate and the row upload updates) |
| S3 | Gym branding CRUD + public read-by-slug | No — is the first slice that exposes real, gated, tenant-scoped behavior end-to-end | S1, S2 (needs schema + storage port to persist/serve logos) |
| S4 | Login page host-resolved theming | No — consumes S3's public endpoint | S3 |
| S5 | Whole-app root-layout theming | No — consumes S3's authenticated branding read; reuses S4's CSS-var pattern | S3 (and benefits from S4 landing first for a consistent inline-`<style>` helper, though not strictly blocking) |

Ordering rationale: schema/contracts (S1) land first and are inert — reviewable
in isolation with zero behavior change, same pattern as 15a S1. Storage (S2) is
isolated behind a port so it can be reviewed for the "net-new file-upload"
risk on its own, independent of billing-gated CRUD logic. S3 is the security
seam (entitlement gating + tenant isolation + the new PUBLIC unauthenticated
endpoint) and is reviewed in isolation from any UI before either theming slice
wires into it — this keeps the auth/isolation diff small and auditable, same
rationale as 15a's S2/S3 split. S4 (pre-auth, external-facing) ships before S5
(post-auth, whole-app) because it is the smaller, host-header-driven surface
and exercises the public endpoint from S3 directly; S5 then reuses the same
`var(--gym-x, var(--default))` mechanism app-wide once proven working on one
page.

## Non-Goals / Deferred (explicit, tracked, not built this change)

- Admin UI for assigning the `"gym"` tier or `subdomainSlug` — provisioning is
  API-only (existing admin-override path for tier; slug set on first branding
  upsert). Follow-up: file an issue if an admin UI is desired later.
- Prod `STORAGE_LOCAL_DIR` mount path on the VPS deploy volume — an ops
  action outside this repo (`/mnt/blockvolume/homes/kinora/deploy/...`),
  tracked as an open question in `design.md`; each S2 task below stays
  correct with any mount path since the adapter takes a configurable base dir.
- Reverse-proxy/DNS wildcard routing (`*.kinora.aitsai.com → web`) — external
  infra prerequisite; blocks true end-to-end subdomain testing regardless of
  app-level correctness (S4's host-resolution tests substitute a fake/forced
  `Host` header instead).

---

## Phase 1 (Slice S1): `tenant_branding` schema + `"gym"` tier + contracts

- [x] 1.1 RED: migration test asserting `"gym"` exists in the `billing_tier`
      enum (mirrors `apps/api/src/db/__tests__/trainer-schema.test.ts`).
- [x] 1.2 GREEN: new migration file A — `ALTER TYPE "public"."billing_tier" ADD
      VALUE IF NOT EXISTS 'gym';` ONLY (own file, no other schema change in
      the same transaction — mirrors 15a's `0016_trainer_role_tier_enum.sql`
      same-transaction gotcha).
- [x] 1.3 RED: migration test asserting `tenant_branding` table exists with
      columns `tenantId` (FK), `subdomainSlug` (unique), `logoStorageKey`
      (nullable), six hex-color columns with CHECK `^#[0-9a-fA-F]{6}$`,
      `createdAt`/`updatedAt`.
- [x] 1.4 GREEN: new migration file B (separate from 1.2, since the new enum
      value cannot be referenced in the same transaction it was added in) —
      `CREATE TABLE tenant_branding` + unique index on `subdomainSlug`, added
      to `apps/api/src/db/schema.ts`.
- [x] 1.5 GREEN: extend `BillingTier` union with `"gym"` in
      `packages/contracts/src/index.ts`; add `TenantBrandingDTO`,
      `BrandingPalette`, `LogoUploadResponseDTO` types.
- [x] 1.6 RED: unit test for hex-color validation helper (`^#[0-9a-fA-F]{6}$`
      per field) — valid/invalid cases, pure function.
- [x] 1.7 GREEN: implement the hex-validation helper (e.g.
      `apps/api/src/branding/palette.ts`).
- [x] 1.8 Create `apps/api/src/db/repositories/tenant-branding.ts` with CRUD
      scaffolding (no route wiring yet) — same "inert repo first" pattern as
      15a S1's `trainer-assignment.ts`.
- [x] 1.9 Gate: run `pnpm architecture` — confirm no route file imports
      `db/repositories/*` directly (repo stays reachable only via injected
      structural interfaces); confirm clean.
- [x] 1.10 Gate: run full `apps/api` test suite green; confirm S1 is dark
      (no behavior change) and independently mergeable.

> **S1 note (beyond tasks.md's explicit list)**: additionally extended
> `resolveTenantFeatureLimit` (`apps/api/src/billing/plan-limits.ts`) with a
> `GYM_TIER_LIMITS` branch (mirrors `trainer`'s dark/additive entitlement
> plumbing) per the orchestrator's Slice S1 scope note #5. Covered by a new
> `resolveTenantFeatureLimit — gym tier` describe block in
> `plan-limits.test.ts`. No route gates on it yet.

## Phase 2 (Slice S2): `ObjectStoragePort` + `LocalStorageAdapter` + upload/serve routes

- [x] 2.1 RED: `LocalStorageAdapter.put` unit test — writes bytes to a temp
      dir under a server-generated UUID key (no path traversal from caller
      input), returns `{ url }`.
- [x] 2.2 RED: `LocalStorageAdapter.get` unit test — returns `{ bytes,
      contentType }` for an existing key, `null` for an unknown key.
- [x] 2.3 RED: `LocalStorageAdapter.delete` unit test — removes the file;
      idempotent on a missing key.
- [x] 2.4 GREEN: implement `ObjectStoragePort` interface (boundary) in
      `apps/api/src/storage/object-storage-port.ts` and
      `LocalStorageAdapter` (infra) in
      `apps/api/src/storage/local-storage-adapter.ts`, base path from
      `STORAGE_LOCAL_DIR` env (configurable, defaulting to a documented local
      path).
- [x] 2.5 RED: fake `ObjectStoragePort` test double + route test —
      `POST /branding/logo` rejects a disallowed content-type (outside
      `png|jpeg|svg|webp`), writes no storage key.
- [x] 2.6 RED: route test — `POST /branding/logo` rejects a file exceeding the
      configured size cap, writes no storage key.
- [x] 2.7 RED: route test — `POST /branding/logo` accepts a valid `png` under
      the cap, persists via the port, and the response includes the new
      logo URL. **Deviation from the original task wording**: the
      branding-row persistence is NOT stubbed/deferred here — the
      orchestrator's Slice S2 scope required real gating + persistence from
      the start (merge safety). The route calls `repo.upsert` when a
      branding row already exists for the tenant (updating only
      `logoStorageKey`, preserving the existing palette/slug); when no row
      exists yet, the upload still succeeds (bytes stored, URL returned) but
      no row is created — row creation (which sets the unique
      `subdomainSlug`) stays Slice 3's responsibility, so this route never
      risks inventing a colliding slug.
- [x] 2.8 GREEN: implement `POST /branding/logo` in
      `apps/api/src/routes/branding.ts` (allowlist + size-cap validation,
      calls `ObjectStoragePort.put`), injected via a structural interface
      (not a direct repo import) to satisfy `pnpm architecture`. Gated by
      `requireAuth()` + `assertGymEntitled` (pulled forward from task 3.1/3.2
      below — see note after this phase).
- [x] 2.9 RED: route test — `GET /media/branding/:key` streams bytes +
      stored content-type for an existing key; unknown key → 404.
- [x] 2.10 RED: route test — `GET /media/branding/:key` serving an SVG sets
      `Content-Disposition: attachment` (stored-XSS mitigation per the
      threat matrix), never inline-rendered as HTML/script context.
- [x] 2.11 GREEN: implement `GET /media/branding/:key` in
      `apps/api/src/routes/branding.ts`.
- [x] 2.12 Gate: run `pnpm architecture` — confirm `LocalStorageAdapter`
      stays infra-layer-only and `branding.ts` route depends on the
      `ObjectStoragePort` boundary interface, not the concrete adapter or
      raw `fs` calls, and not `db/repositories/*` directly. PASS (0
      violations, 1927 modules / 5706 deps cruised).
- [x] 2.13 Gate: run full `apps/api` test suite green. PASS (125 files, 1628
      tests, 11 skipped).

> **S2 note (deviation from tasks.md's phase split)**: the session prompt's
> merge-safety requirement ("do NOT ship an ungated upload endpoint to
> main") required real gym-tier gating in THIS slice, not deferred to S3.
> Implemented `assertGymEntitled` + `ForbiddenGymAccess` in
> `apps/api/src/billing/gym-access.ts` now (pulling forward task 3.1/3.2's
> intent). Unlike `assertTrainerEntitled`, this gate is TIER-ONLY — there is
> no `"gym"` value in `MembershipRole`, so gating never checks role, only the
> resolved billing tier via the same `resolveEffectiveTier`. Slice 3 reuses
> this SAME helper unchanged for the branding CRUD routes and tenant-
> isolation tests; tasks 3.1/3.2 become a no-op / reference-only when S3
> lands (the helper + its unit tests already exist).

## Phase 3 (Slice S3): Gym branding CRUD + public read-by-slug (isolation + gating)

- [ ] 3.1 RED: `assertGymEntitled` unit test — tier `!== "gym"` throws
      `ForbiddenOwnerAccess`; tier `=== "gym"` passes (mirrors
      `assertTrainerEntitled` shape in `apps/api/src/trainer/owner-access.ts`).
- [ ] 3.2 GREEN: implement `assertGymEntitled` in
      `apps/api/src/billing/*` or `owner-access.ts` (per design's file map).
- [ ] 3.3 RED: route test — non-gym tenant calling branding CRUD or
      `POST /branding/logo` → flat 403, no write (wires 2.5-2.8's upload
      route through the real gate for the first time).
- [ ] 3.4 RED: route test — gym-tier owner submits a full valid palette + logo
      via CRUD → branding row created/updated, response echoes new values.
- [ ] 3.5 RED: route test — palette field not matching
      `^#[0-9a-fA-F]{6}$` → HTTP 400, no row persisted or updated (uses
      1.6/1.7's validator).
- [ ] 3.6 RED: integration test — gym A owner attempts to write branding using
      gym B's `tenantId` → rejected, gym B's row unchanged (tenant isolation,
      2 seeded gym tenants, fake `ObjectStoragePort`).
- [ ] 3.7 RED: integration test — gym A member requests branding through the
      authenticated route → only gym A's branding returned, gym B's data
      never appears.
- [ ] 3.8 GREEN: implement gym branding CRUD routes in
      `apps/api/src/routes/branding.ts`, gated by `assertGymEntitled`,
      scoped by `tenantId` on every read/write, `subdomainSlug` set
      unique-indexed on first upsert.
- [ ] 3.9 RED: route test — `GET /public/branding/by-slug/:slug` for a known
      slug returns only `logoUrl` + `palette`, no PII, no cross-tenant leak.
- [ ] 3.10 RED: route test — `GET /public/branding/by-slug/:slug` for an
      unknown slug → 404 (not an error page), no server error.
- [ ] 3.11 GREEN: implement `GET /public/branding/by-slug/:slug` in
      `apps/api/src/routes/public-branding.ts` — unauthenticated, read-only,
      tenant-scoped by slug lookup only (host header never trusted for
      authz, per the threat matrix).
- [ ] 3.12 Gate: extend the trainer-style regression guard (or add an
      equivalent `branding-route-authz-guard` test) enumerating the
      gym-scoped routes, proving deny-before-any-repo-call for non-gym
      tenants on every CRUD/upload route.
- [ ] 3.13 Gate: run `pnpm architecture` — confirm `routes/branding.ts` and
      `routes/public-branding.ts` depend only on injected structural
      interfaces, never `db/repositories/*` directly.
- [ ] 3.14 Gate: run full `apps/api` test suite green.

## Phase 4 (Slice S4): Login page host-resolved theming

- [ ] 4.1 RED (web): login page Server Component test — a request with a
      `Host` header matching a configured gym's `subdomainSlug` fetches that
      tenant's branding from the public endpoint and renders an inline
      `<style>:root{--gym-accent:<hex>;...}</style>` block + logo `<img>`.
- [ ] 4.2 RED (web): login page test — a `Host` header resolving to no known
      slug renders with default kInorA tokens, no server error, no inline
      gym `<style>` override values.
- [ ] 4.3 RED (web): login page test — the public branding fetch failing
      (e.g. network/5xx) still renders the page with default tokens (fails
      safe, no unhandled rejection surfaced to the user).
- [ ] 4.4 GREEN: implement host→slug resolution
      (`headers().get("host")` server-side, Node runtime) + inline `<style>`
      + logo rendering in `apps/web/src/app/(auth)/login/page.tsx`.
- [ ] 4.5 GREEN: add `--gym-*` CSS custom properties with
      `var(--gym-x, var(--default))` fallback to `globals.css` (mirrors
      15b's pattern) so untouched tokens degrade safely.
- [ ] 4.6 Gate: run `pnpm ui-api-guard` — confirm the login page (a web
      client/server component) does not import server-only modules
      improperly across the boundary.
- [ ] 4.7 Gate: run `pnpm architecture` — no `apps/web` route imports
      `db/repositories/*` or the storage adapter directly; branding fetch
      goes through the public HTTP endpoint only.
- [ ] 4.8 Gate: run full `apps/web` test suite green.

## Phase 5 (Slice S5): Whole-app root-layout theming for logged-in members

- [ ] 5.1 RED (web): root layout test — a logged-in member whose active
      tenant has branding configured renders an inline `<style>` block with
      that tenant's palette, consumed via `var(--gym-x, var(--default))`
      across shared layout chrome.
- [ ] 5.2 RED (web): root layout test — a logged-in member whose tenant has
      no `tenant_branding` row renders default kInorA tokens, no error.
- [ ] 5.3 GREEN: implement post-login tenant palette injection in
      `apps/web/src/app/layout.tsx`, resolving branding from the session's
      active tenant (authenticated read from S3, not the public endpoint).
- [ ] 5.4 GREEN: extend `globals.css` / add a branding module reusing S4's
      `--gym-*` token set app-wide.
- [ ] 5.5 E2E (deferred, noted not blocking): true subdomain end-to-end is
      blocked on the external reverse-proxy wildcard (non-goal, tracked in
      `design.md`'s Migration/Rollout section) — substitute a forced-`Host`-
      header integration test for S4/S5 instead of a live subdomain test.
- [ ] 5.6 Gate: run `pnpm ui-api-guard` — confirm root layout stays within
      the web client/server-module boundary.
- [ ] 5.7 Gate: run `pnpm architecture` — confirm no new violations
      introduced by the layout change.
- [ ] 5.8 Gate: run full `apps/web` test suite green; confirm whole-app
      manual smoke (or Playwright) shows the palette on at least one
      non-login screen.

## Phase 6: Cleanup / Docs

- [ ] 6.1 Update `openspec/specs/{16a,11a}/spec.md` once archived, merging
      the deltas already drafted in `specs/` (mirrors 15a's Phase 6.1).
- [ ] 6.2 Confirm both open design questions remain explicitly tracked
      post-archive: (a) prod `STORAGE_LOCAL_DIR` mount path — ops follow-up;
      (b) admin UI vs. API-only tier/slug assignment — no admin UI built
      this change, file a follow-up issue if one is wanted.
