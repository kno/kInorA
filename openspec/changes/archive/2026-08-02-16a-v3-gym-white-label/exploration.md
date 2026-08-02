## Exploration: 16a-v3-gym-white-label (Gym white-label branding)

### Current State

**Multi-tenant model (no branding fields today)**
- `tenants` table: `apps/api/src/db/schema.ts:155-160` — only `id`, `name`, `createdAt`, `updatedAt`. No logo/color/domain columns, no branding-related table anywhere in the schema.
- `billingTierEnum` = `["free", "pro", "trainer"]` (`apps/api/src/db/schema.ts:107`). No "gym" tier exists. 15a added `trainer` additively; 16a would need the same additive pattern for a gym concept — either a new tier value or a separate `tenants.isGym`/`gym_branding` relation, NOT necessarily a billing-tier change.
- Tenant resolution today happens strictly POST-AUTH: `provisionTenantForUser` (`apps/api/src/tenant/provisioning.ts:49-116`) creates a tenant at signup; `SocialAuthService.tenantContextFor`/`resolveUserTenantContext` (`apps/api/src/auth/social.ts:193-257`) resolves tenant from an existing membership after OAuth callback. `TenantQueryContext` (`apps/api/src/tenant/tenant-context.ts:11`) and `authContext` (`apps/api/src/auth/plugin.ts:93`) both require an established session — there is no host/domain-based lookup anywhere in the auth or tenant modules.
- **Confirmed: no host→tenant mapping exists today.** Grepping the whole repo for `server_name`, `VIRTUAL_HOST`, `subdomain` found only irrelevant matches. This is a genuine gap 16a must fill.

**Web host/routing seam**
- `apps/web/next.config.ts:41-55` — only a `rewrites()` for `/api/:path*` → `http://api:4000`. No host-based logic.
- `apps/web/src/proxy.ts` (Next.js 16's single middleware/proxy file, replaces `middleware.ts`) — currently does two things only: (1) auth-gate protected paths (`/dashboard`, `/plan`, `/profile`, `/stats`, `/create-plan`, `/exercises` — `PROTECTED_PATH_PREFIXES` at line 30), and (2) forward `?lang=` as `x-kinora-lang` for i18n. It reads headers but **never reads `request.headers.get("host")`** — the natural seam to add subdomain→tenant resolution (inject `x-kinora-gym-slug`), OR do the lookup directly in a server component via `headers().get("host")`.
- Login page is a plain async Server Component: `apps/web/src/app/(auth)/login/page.tsx` — no branding data fetched today, static `kin-*` classes from `globals.css`.
- Prod: web served at `kinora.aitsai.com` behind a reverse proxy; no nginx/Caddy wildcard-subdomain vhost config is checked into this repo (infra lives outside the codebase — flagged as a risk/unknown).

**Theming seam (15b precedent)**
- `apps/web/src/app/globals.css:9-21` defines global `:root` tokens (`--surface`, `--fg`, `--accent`, `--accent-fg`, `--accent-dim`, ...). Truly global — no tenant override mechanism.
- 15b precedent: `apps/web/src/app/(app)/plan/PlanTrackerClient.tsx:181` and `PlanStatusView.tsx:108` set `{"--plan-accent": branding.accentColor}` as an inline style on a wrapping element (not global `:root`); `plan-week-view.module.css` consumes it everywhere via `var(--plan-accent, var(--accent))`. This is exactly the reusable pattern for gym branding: set `--gym-accent` on a root wrapper (or `<html>`/`<body>`) with a fallback to `--accent`, achieving Requirement 2 (branding shows) AND Requirement 3 (default fallback) for free via the CSS `var(x, fallback)` mechanic — no JS branching for the fallback.
- **15b branding is per-PLAN**, inside `PlanSpec.specJson.branding` (`apps/api/src/routes/trainer.ts:104-117, 259-269`), NOT per-tenant — architecturally different from 16a's tenant-level, pre-auth need; cannot reuse the storage directly.

**Asset/logo upload — confirmed absent**
- Grepped `apps/api/src` for `upload|multipart|S3|storage|asset` — all matches unrelated. **No file/image upload mechanism anywhere in the API.** Even exercise images are checked-in static webp in `apps/web/public/`. A gym logo has no existing upload path — new infra if "upload" is in scope, vs. trivial if scope is just a URL field.

### Affected Areas
- `apps/api/src/db/schema.ts` — new `tenant_branding`/`gym_branding` table (tenantId FK, logoUrl, accentColor, subdomainSlug unique) + possibly a `tenants.isGym` flag or `"gym"` billing tier.
- `apps/web/src/proxy.ts` — the only existing routing seam (would need host parsing + a lookup via a new public API endpoint, since the edge proxy can't import DB code — consistent with the `routes-no-db-layer` rule).
- `apps/web/next.config.ts` — possible `rewrites()`/`redirects()` if subdomains are proxied to the same Next app rather than handled by a reverse proxy + header.
- `apps/web/src/app/(auth)/login/page.tsx` — becomes branding-aware (server fetch by host, apply `--gym-accent`, render logo).
- `apps/web/src/app/globals.css` + a new CSS module (mirroring `plan-week-view.module.css`).
- New API route(s): gym-owner CRUD for branding + a PUBLIC (pre-auth, unauthenticated) tenant-isolated read endpoint for the login page/proxy to resolve branding by subdomain — new attack surface, must be strictly tenant-scoped.
- NOT expected to change: `social.ts`/`provisioning.ts`/`tenant-context.ts` for the branding read itself (post-auth resolution unaffected) — but the "how a tenant becomes a gym" answer may touch provisioning.

### Approaches

**(a) Subdomain → tenant resolution for the pre-auth login page**
1. **Next.js proxy (edge) header injection** — `proxy.ts` parses `host`, resolves the gym via a public API/cache, injects `x-kinora-gym-slug`. Pros: single existing seam, mirrors `x-kinora-lang`. Cons: a round-trip per request unless cached; Edge runtime restricts DB access (must call the API over HTTP). Effort: Medium.
2. **Server Component reads `headers().get("host")` on the login page** (no proxy involvement). Pros: simplest, scoped to the one page that needs it, avoids touching the shared proxy (auth-gate + i18n), Node runtime (no edge restrictions). Cons: per-page opt-in — if "brand the whole app" is in scope it must move to the root layout later. Effort: Low. **Recommended.**
3. **DNS/reverse-proxy wildcard (`*.kinora.aitsai.com`)** — a prerequisite infra step (routing all gym subdomains to the same Next app) needed regardless of the app-level choice, not an alternative to 1/2.

**(b) Where branding lives + injection**
1. **New `tenant_branding` table** (tenantId FK, logoUrl, accentColor, subdomainSlug unique, timestamps) + public read endpoint; reuse `var(--gym-accent, var(--accent))`. Pros: clean tenant-scoped storage; trivial isolation via `WHERE tenantId=?`; proven CSS mechanism. Cons: new table + migration + CRUD. Effort: Medium. **Recommended.**
2. **JSON column on `tenants`**. Pros: no join. Cons: can't unique-index the subdomain slug inside JSON; weaker relational clarity/type-safety. Effort: Low-Medium.

**(c) Logo hosting**
1. **URL field only** (gym admin pastes a hosted image URL) — zero new infra, matches the codebase's total absence of upload. Effort: Low. **Recommended for slice 1.**
2. **File upload** (multipart + object storage) — net-new infra, no precedent. Effort: High. (Follow-up if wanted.)

**(d) Subdomain-only vs custom domains**
1. **Subdomain only** (`gymname.kinora.aitsai.com`) — matches the spec's literal wording; no per-tenant DNS/TLS. **Recommended.**
2. **Full custom domains** (`app.somegym.com`) — per-tenant DNS verification + TLS provisioning; materially larger scope, not implied by the spec.

### Recommendation
Ship 16a as: a new `tenant_branding` table (tenantId, logoUrl, accentColor, subdomainSlug unique) + gym-owner CRUD + a public unauthenticated read endpoint scoped by subdomain; resolve the gym server-side in the login page via `headers().get("host")` (not touching `proxy.ts` initially); inject `--gym-accent` reusing 15b's `var(--gym-accent, var(--accent))` fallback pattern + a conditional logo `<img>`; subdomain-only, URL-only logo, no custom domains, no upload. Smallest slice satisfying all three roadmap requirements (config, default fallback via CSS `var()`, isolation via scoped reads), deferring infra unknowns (reverse-proxy wildcard, upload) to explicit follow-ups.

**Note (post-design revision)**: the accepted proposal/design LOCKED IN scope beyond this exploration's initial recommendation — full palette (not one accent) and real file upload (not URL-only) were both explicitly requested by the user and delivered. See proposal.md's "Locked scope" and design.md's storage-port decision.

### Risks
- **Reverse-proxy/DNS wildcard subdomain routing is outside this repo** — whether `*.kinora.aitsai.com` currently routes to the web container is unverified and may block end-to-end testing regardless of app-code correctness.
- **Edge runtime constraints** if resolution is later centralized in `proxy.ts` (Edge default) — DB access restrictions force an HTTP round-trip; not present in the recommended login-page (Node) approach.
- **No existing "gym" tier/flag** — how a tenant becomes eligible is an open product question affecting the billing enum + entitlement gating (additive, like 15a's `trainer`).
- **Scope creep**: "login page shows gym branding" vs. "whole app rebrands for gym members after login" are very different sizes; the spec's scenarios only describe the login page.
- **Public unauthenticated branding-read endpoint** is new attack surface — must be read-only, tenant-isolated, no PII, to avoid enumeration/leakage.

### Ready for Proposal
Yes — with product/scope questions to resolve first:
1. Subdomain-only, or also full custom domains? (Recommend subdomain-only.)
2. Branding field set: URL-only logo, or actual file upload (net-new storage)? Which colors — just one accent, or a fuller palette?
3. How does a tenant become a white-label gym: a new `"gym"` billing tier, a boolean flag on `tenants`, or implicit (any tenant with a `tenant_branding` row)?
4. Scope of rebrand: JUST the pre-auth login page (as the spec scenarios literally say), or the whole app after login too?
