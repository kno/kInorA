# Tasks: 06b-v1-orbit-ui-shell

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

Estimated ~810 changed lines across 20+ files. Three natural slices per design:

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Tokens + Landing Page | PR 1 (main) | ~380 lines, bulk of the work |
| 2 | App Shell + Auth Layout | PR 2 (main) | ~280 lines |
| 3 | Scaffold Pages + Proxy | PR 3 (main) | ~150 lines, standalone after PR2 |

## Phase 1: Design Tokens + Landing Page (PR 1)

- [x] [06B-WEB 1.1] Add `--accent-dim` token to `apps/web/src/app/globals.css` — `oklch(89% 0.20 128 / 0.12)`
- [x] [06B-WEB 1.2] Add landing-section CSS classes to `globals.css`: hero, trust strip (4-column), how-it-works (3-step), features grid (4-card), pricing tiers (3-tier), CTA band, footer
- [x] [06B-WEB 1.3] Create `apps/web/src/components/landing/LandingNav.tsx` — sticky nav with brand, nav links, login/sign-up CTA buttons
- [x] [06B-WEB 1.4] Create landing section components: `LandingHero`, `LandingTrust`, `LandingHowItWorks`, `LandingFeatures`, `LandingPricing`, `LandingCTA`, `LandingFooter` in `apps/web/src/components/landing/`
- [x] [06B-WEB 1.5] Rebuild `apps/web/src/app/page.tsx` — compose landing from section components, match Open Design reference structure
- [x] [06B-WEB 1.6] Expand `apps/web/src/i18n/messages/en.json` — add ~60 keys for all landing sections (hero, trust, how-it-works, features, pricing, CTA, footer)
- [x] [06B-TST 1.7] Write unit tests for landing components — render each section, verify key text and structure (Vitest + React Testing Library)
- [x] [06B-TST 1.8] Write Playwright viewport tests: landing renders correctly at 375px, 768px, 1280px, 1920px — no overflow, readable content, tap targets ≥44px

## Phase 2: App Shell + Auth Layout (PR 2)

- [x] [06B-WEB 2.1] Create `apps/web/src/components/AppShell/AppShell.tsx` + `AppShell.module.css` — client wrapper that switches desktop sidebar / mobile bottom nav at 768px breakpoint
- [x] [06B-WEB 2.2] Create `apps/web/src/components/AppShell/SidebarNav.tsx` + `SidebarNav.module.css` — 248px fixed sidebar with wordmark, 5 nav items (Dashboard, Plan, Statistics, Create Plan, Exercises), user area with initials placeholder, active state with `--accent-dim` + 3px left accent border
- [x] [06B-WEB 2.3] Create `apps/web/src/components/AppShell/MobileNav.tsx` + `MobileNav.module.css` — fixed bottom bar with 4 tab items + centered 48px lime FAB, safe-area padding for notched devices
- [x] [06B-WEB 2.4] Create `apps/web/src/app/(app)/layout.tsx` — route group layout rendering `<AppShell>{children}</AppShell>`
- [x] [06B-WEB 2.5] Move `apps/web/src/app/dashboard/page.tsx` to `apps/web/src/app/(app)/dashboard/page.tsx` — update imports, keep placeholder metrics layout
- [x] [06B-TST 2.6] Write unit tests: `matchMedia` mock for viewport switching, sidebar active nav highlights correct route, mobile nav renders correct tabs
- [x] [06B-TST 2.7] Write Playwright test: authenticated navigation — verify sidebar link navigates to each scaffolded route and highlights active item (degraded to integration test; Playwright infra not available)

## Phase 3: Scaffold Pages + Proxy + Cleanup (PR 3)

- [x] [06B-WEB 3.1] Create scaffold pages with shell + placeholder content:
  - `apps/web/src/app/(app)/plan/page.tsx`
  - `apps/web/src/app/(app)/stats/page.tsx`
  - `apps/web/src/app/(app)/create-plan/page.tsx`
  - `apps/web/src/app/(app)/exercises/page.tsx`
  - `apps/web/src/app/(app)/profile/page.tsx`
- [x] [06B-WEB 3.2] Update `apps/web/src/proxy.ts` matcher — add `/stats`, `/create-plan`, `/exercises` routes to auth gate
- [x] [06B-WEB 3.3] Update `apps/web/src/app/offline/page.tsx` — replace inline styles with `kin-*` design token CSS classes
- [x] [06B-CLN 3.4] Remove or clean up any stale page references from old route structure (e.g., standalone `dashboard/` if migrated)
- [x] [06B-TST 3.5] Write Vitest auth-gate integration test: unauthenticated access to scaffold routes redirects to login
- [x] [06B-TST 3.6] Write Vitest integration tests: scaffold pages render shell + placeholder without errors

## Verification Gates

Before each merge:
- [x] [06B-GATE 1] `pnpm type-check` passes
- [x] [06B-GATE 2] `pnpm test` passes (all tests including new ones)
- [x] [06B-GATE 3] `pnpm build` passes (deps-guard + architecture + web + api)
- [x] [06B-GATE 4] `pnpm deps-guard` passes (no new prohibited dependencies)
