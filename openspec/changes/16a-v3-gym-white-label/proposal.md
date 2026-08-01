# Proposal: Gym White-Label Branding (16a, v3)

## Intent

Let a gym operate kInorA under its own brand on a dedicated subdomain
(`gymname.kinora.aitsai.com`): its logo and color palette appear on the pre-auth
login page (resolved by request host) and across the whole app after a member
logs in, with a clean fallback to default kInorA tokens. This is the first slice
of a larger, chained v3 white-label capability.

## Scope

### In Scope
- Subdomain-only white-label (`gymname.kinora.aitsai.com`).
- Full branding: real logo **file upload** + a fuller palette (accent, surface/background, foreground/text).
- New `"gym"` billing tier (additive enum entry, mirroring 15a `trainer`); branding CRUD gated on it.
- Whole-app rebrand after login (root layout CSS custom properties) + host-resolved login page pre-auth.
- Tenant isolation on every branding read/write (`WHERE tenantId=?`).

### Out of Scope
- Custom domains (`app.somegym.com`) — no per-tenant DNS/TLS.
- Per-member theme overrides; theming non-gym tenants.
- Reverse-proxy/DNS wildcard infra (lives outside this repo).

## Capabilities

### New Capabilities
- `16a-v3-gym-white-label`: tenant-level branding config (palette + uploaded logo), subdomain→tenant resolution, public tenant-scoped branding read, whole-app + login theming with default fallback.

### Modified Capabilities
- `11a-v1-billing-plans-tiers`: add `"gym"` to the billing tier enum and its entitlement gating.

## Approach

- New `tenant_branding` table: `tenantId` FK, `subdomainSlug` UNIQUE, logo reference, palette colors, timestamps.
- Subdomain resolution: login page Server Component reads `headers().get("host")` (Node runtime) and calls a new PUBLIC, unauthenticated, read-only, tenant-scoped branding-by-slug endpoint (no PII).
- Logo upload: new authenticated gym-owner upload endpoint + storage returning a stable URL; validate content-type/size. **Storage mechanism (mounted VPS volume vs. object store) is a design-phase open question — not decided here.**
- Theming: inject palette as CSS custom properties on the root layout (app-wide) and login page, each `var(--gym-x, var(--default))` — reuses 15b's pattern and gives default fallback for free.
- Billing: gate branding-management routes on the `"gym"` tier, mirroring 15a `trainer` gating.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | Modified | New `tenant_branding` table; `"gym"` in `billingTierEnum` (line 107) |
| `apps/api/src/routes/*` (new) | New | Gym-owner branding CRUD + logo upload + PUBLIC read-by-slug endpoint |
| Object storage / upload infra | New | Net-new file-upload + storage (no precedent in repo) |
| `apps/web/src/app/(auth)/login/page.tsx` | Modified | Host-resolved branding fetch + apply palette/logo |
| `apps/web/src/app/layout root` | Modified | Whole-app theme injection with fallback |
| `apps/web/src/app/globals.css` + new module | Modified/New | `--gym-*` tokens mirroring `plan-week-view.module.css` |
| Billing entitlement gating | Modified | `"gym"` tier checks on branding routes |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Net-new file-upload/object-storage infra, no precedent anywhere in API | High | Isolate storage behind an interface; make mechanism an explicit design open question; validate size/type |
| Public unauthenticated branding-read endpoint = new attack surface | Med | Read-only, tenant-scoped, no PII, rate-limit; slug lookup only |
| Reverse-proxy/DNS wildcard routing lives OUTSIDE repo, unverified | High | Flag as external prerequisite; may block end-to-end testing regardless of app correctness |
| Whole-app theming touches every screen's token usage | Med | Use `var(--gym-x, var(--default))` fallback so untouched tokens degrade safely |
| Large v3 feature spanning multiple chained slices | Med | Deliver as chained PRs (schema+billing → API+upload → theming) |

## Rollback Plan

Revert migration (drop `tenant_branding`) and remove `"gym"` from the enum
(no existing rows depend on it). Login page and root layout fall back to default
`kin-*`/`--default` tokens automatically via CSS `var()` fallback, so removing the
branding fetch is non-breaking. Upload endpoint/storage removed independently.

## Dependencies

- `01c-v1-multi-tenant-schema` — tenant model + isolation.
- `05b-v1-security-tenant-validation` — tenant-scoped read enforcement.
- `11a-v1-billing-plans-tiers` — billing tier enum + entitlement gating.
- `15b-v2-trainer-dashboard-branding` — CSS-var branding precedent.

## Open Questions for Design

- Storage mechanism for uploaded logos (mounted VPS volume vs. S3/R2 object store).
- Exact palette token set (which `--gym-*` variables are authoritative).
- How gym subdomains reach the Next app in prod (wildcard reverse-proxy/DNS).
- How a tenant is assigned the `"gym"` tier and its `subdomainSlug`.

## Success Criteria

- [ ] Visiting `gymname.kinora.aitsai.com` shows that gym's logo + palette on the login page pre-auth.
- [ ] After login, the whole app renders in the member's tenant branding.
- [ ] Unknown/absent host falls back cleanly to default kInorA tokens.
- [ ] Branding CRUD + logo upload restricted to `"gym"`-tier owners; reads tenant-isolated.
- [ ] A gym cannot read or write another tenant's branding.
