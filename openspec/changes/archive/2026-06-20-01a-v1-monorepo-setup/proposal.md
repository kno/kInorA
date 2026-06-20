# Proposal: 01a V1 Monorepo Setup

## Intent

Activate the README roadmap's first implementation slice by turning the existing `01a-v1-monorepo-setup` baseline spec into a runnable minimal monorepo. This change gives developers a visible web page, a real API health endpoint, shared package resolution, basic EN/ES localization support, and root commands before deeper architecture work in `01b-v1`.

## Scope

### In Scope
- pnpm workspace layout with `apps/web`, `apps/api`, and `packages/*`.
- Minimal Next.js + TypeScript web app with a visible first page.
- Mobile-aware visible page that does not break on a basic mobile viewport, without implementing full PWA/native support.
- Initial i18n support for English and Spanish UI copy.
- Minimal Fastify API with an HTTP 200 health route.
- Shared contracts package importable as `@kinora/contracts`.
- Root scripts for install/dev/build/type-check/test where appropriate for the baseline.

### Out of Scope
- DB, auth, Stripe, AI, Docker, CI/CD, mobile, and tenant capabilities.
- PWA installability, service workers, offline fallback, and Capacitor/native shell; defer to `06-v1-mobile-foundation`.
- Clean Architecture boundaries beyond what `01a` needs to run; defer to `01b-v1`.
- Product flows beyond a visible web start page and API health response.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `01a-v1-monorepo-setup`: Activate the existing baseline with delta requirements for latest stable/LTS stack choices, visible mobile-aware web startup, EN/ES localization support, real Fastify API, and tight exclusion of later roadmap capabilities.

## Approach

Use current stable/LTS versions suitable for a minimal baseline. Create workspace manifests and TypeScript config, scaffold `apps/web` as a minimal Next.js app with responsive-safe first page and EN/ES message loading, scaffold `apps/api` as a real Fastify server exposing health, and add `packages/contracts` for shared type imports. Keep implementation intentionally thin so future slices own architecture, PWA/native mobile, persistence, auth, billing, AI, Docker, and CI.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `package.json`, `pnpm-workspace.yaml` | New | Root workspace scripts and package discovery. |
| `apps/web` | New | Visible Next.js baseline page. |
| `apps/web` i18n | New | Initial English and Spanish UI messages. |
| `apps/api` | New | Fastify baseline with health route. |
| `packages/contracts` | New | Shared package alias used by apps. |
| `openspec/specs/01a-v1-monorepo-setup/spec.md` | Modified | Requirement activation through delta spec. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Baseline overreaches into `01b` architecture | Med | Keep app logic minimal and defer architecture decisions. |
| Mobile/i18n setup expands the slice | Med | Limit mobile to responsive-safe baseline and i18n to EN/ES startup copy. |
| Version drift from latest stable/LTS | Low | Pin concrete versions during implementation. |

## Rollback Plan

Remove the added workspace files/directories and revert the `01a-v1-monorepo-setup` delta before archive; no persisted data or external services are involved.

## Dependencies

- Node.js LTS and pnpm.

## Success Criteria

- [ ] `pnpm install` resolves all workspaces.
- [ ] `pnpm dev` starts web and API baselines.
- [ ] Web app shows a visible page on first start.
- [ ] Web page renders without layout breakage on a basic mobile viewport.
- [ ] Web startup UI can render in English and Spanish.
- [ ] API health route returns HTTP 200.
- [ ] `apps/api` resolves `@kinora/contracts`.
