# Design: Gym White-Label Branding (16a, v3)

## Technical Approach

New `tenant_branding` table (palette + uploaded-logo key) keyed by a unique
`subdomainSlug`; a hexagonal `ObjectStoragePort` with a `LocalStorageAdapter`
for logo bytes; gym-owner branding CRUD + logo upload gated on a new additive
`"gym"` billing tier (mirrors 15a `trainer`); a PUBLIC read-by-slug endpoint;
and server-rendered inline `<style>` token injection on the login page and root
layout, consuming `var(--gym-*, var(--default))` for automatic fallback.
Delivered as 5 chained slices.

## Architecture Decisions

### Decision: Logo storage behind a hexagonal port
**Choice**: Define `ObjectStoragePort` (`put/get/delete`) in the API
boundary layer; implement `LocalStorageAdapter` (infra) writing to
`env STORAGE_LOCAL_DIR` (default a persistent path). It returns a storage KEY;
a stable public URL (`/media/branding/:key`) is served by a read route
streaming bytes from disk with the stored content-type.
**Alternatives**: S3/R2 now (net-new infra, cost); inline URL-only field (loses
real upload from locked scope).
**Rationale**: Swappable backend later with zero caller changes; adapter is the
only file-system-aware code. Prod MUST mount `STORAGE_LOCAL_DIR` under the VPS
deploy volume (`/mnt/blockvolume/homes/kinora/deploy/...`) OUTSIDE the image so
uploads survive redeploys.

### Decision: On-the-fly CSS via server-rendered inline `<style>`
**Choice**: Resolve the tenant palette server-side (login: from
`headers().get("host")`→slug; app: from the member's tenant) and emit one
`<style>:root{--gym-accent:<hex>;...}</style>` in the layout/page. Global CSS
uses `var(--gym-accent, var(--accent))` etc. so absent branding falls back with
NO JS branching.
**Alternatives**: A cacheable `text/css` route keyed by tenant — adds a
render-blocking request + flash-of-unbranded-content; caching a tiny (~6 var)
per-tenant payload is marginal.
**Rationale**: Zero extra request, no FOUC, one server round already made for
branding data.

### Decision: `"gym"` tier is additive; assignment is admin-provisioned
**Choice**: Append `"gym"` to `billingTierEnum` (`ALTER TYPE ... ADD VALUE`, no
ordinal churn) and `BillingTier`. Gate branding CRUD/upload with an
`assertGymEntitled` helper mirroring `assertTrainerEntitled`
(role/tier `!== "gym"` → `ForbiddenOwnerAccess`). Tier + `subdomainSlug` are set
by an existing admin/provisioning action (reuse the admin-override path for tier;
slug set on the first branding upsert, unique-indexed).
**Rationale**: Proven 15a pattern; no new auth surface.

## Data Flow

    Login (host)                         Post-login (session tenant)
    headers().host ──→ slug              tenantId ──→ branding row
        │                                    │
        ▼                                    ▼
    GET /public/branding/by-slug/:slug   inline <style> in root layout
        │ (read-only, no PII)                │
        ▼                                    ▼
    inline <style> + <img src=media>     whole app themed via var() fallback

    Upload: POST /branding/logo ─(gym-gated)→ ObjectStoragePort.put ─→ LocalAdapter(disk)
                                                         │
    Serve:  GET /media/branding/:key ──────────────── read bytes + content-type

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | Modify | `"gym"` in `billingTierEnum`; new `tenantBranding` table |
| `apps/api/src/db/migrations/*` | Create | ADD enum value + create table + unique slug index |
| `apps/api/src/storage/object-storage-port.ts` | Create | `ObjectStoragePort` interface (boundary) |
| `apps/api/src/storage/local-storage-adapter.ts` | Create | Disk adapter, configurable base path |
| `apps/api/src/routes/branding.ts` | Create | Gym CRUD + `POST /branding/logo` + `GET /media/branding/:key` |
| `apps/api/src/routes/public-branding.ts` | Create | `GET /public/branding/by-slug/:slug` (unauth, tenant-scoped) |
| `apps/api/src/billing/*` / `owner-access.ts` | Modify | `assertGymEntitled` gate |
| `packages/contracts/src/index.ts` | Modify | `BillingTier += "gym"`; `TenantBrandingDTO`, `BrandingPalette`, `LogoUploadResponseDTO` |
| `apps/web/src/app/(auth)/login/page.tsx` | Modify | Host→slug fetch, inline `<style>`, logo `<img>` |
| `apps/web/src/app/layout.tsx` | Modify | Post-login tenant palette injection |
| `apps/web/src/app/globals.css` + module | Modify | `--gym-*` fallbacks |

## Interfaces / Contracts

```ts
interface ObjectStoragePort {
  put(key: string, bytes: Buffer, contentType: string): Promise<{ url: string }>;
  get(key: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}
interface BrandingPalette { accent; accentFg; surface; surface2; fg; muted } // hex, validated
interface TenantBrandingDTO { tenantId; subdomainSlug; logoUrl: string|null; palette: BrandingPalette }
```
Table columns: `tenantId` FK, `subdomainSlug` text UNIQUE, `logoStorageKey` text
null, six hex color columns (CHECK `^#[0-9a-fA-F]{6}$`), `createdAt/updatedAt`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `LocalStorageAdapter` put/get/delete; path-traversal-safe keys | temp dir |
| Unit | `resolveEffectiveTier` unchanged + `assertGymEntitled` deny non-gym | fake reader |
| Unit | Hex validation; palette→CSS string | pure |
| Integration | Branding CRUD tenant isolation (gym A cannot read/write B) | fake `ObjectStoragePort`, seeded 2 tenants |
| Integration | Public read-by-slug: no PII, unknown slug → 404, no cross-tenant leak | route test |
| Integration | Upload rejects bad content-type + oversize; allowlist png/jpeg/svg/webp | route test |
| Web | Login inline `<style>` present; unknown host → default tokens (fallback) | RSC render |
| E2E (deferred) | Subdomain end-to-end — blocked on external reverse-proxy | note |

## Threat Matrix

Canonical Git/shell/PR/subprocess rows: **N/A** — no VCS, shell, or process
integration. Analogous upload/serve controls ARE in scope and covered by
decisions + tests: (1) content-type allowlist + size cap; (2) SVG served with
`Content-Disposition: attachment` / sanitized to prevent stored-XSS; (3) storage
keys are server-generated UUIDs (no path traversal); (4) host header is used
only for a read-only slug lookup, never trusted for authz.

## Migration / Rollout

Additive: `ALTER TYPE billing_tier ADD VALUE 'gym'`, then `CREATE TABLE
tenant_branding`. Rollback = drop table + remove branding fetch; CSS `var()`
fallback keeps every screen on default `kin-*` tokens. Reverse-proxy wildcard
`*.kinora.aitsai.com → web` is an EXTERNAL delivery prerequisite; app
unit/integration correctness does NOT depend on it.

## Slice Plan (chained PRs)

- **S1**: `tenant_branding` schema + `"gym"` tier + contracts (`BillingTier`, DTOs).
- **S2**: `ObjectStoragePort` + `LocalStorageAdapter` + upload/serve routes.
- **S3**: Gym branding CRUD + public read-by-slug (isolation + gating).
- **S4**: Login page host-resolved theming (inline `<style>` + logo).
- **S5**: Whole-app root-layout theming for logged-in members.

## Open Questions

- [ ] Confirm prod `STORAGE_LOCAL_DIR` mount path on the VPS deploy volume.
- [ ] Admin UI vs. API-only for assigning `"gym"` tier + slug (S1 uses API/provisioning).
