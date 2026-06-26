# Tasks: 06c Open Design Component Foundation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 450-700 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 snapshot refresh → PR 2 icons/primitives → PR 3 proof wiring/tests/docs |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No — resolved 2026-06-26 as `stacked-to-main`
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Refresh Open Design snapshot and provenance | PR 1 | Base on current change branch; live MCP refresh only, no web code |
| 2 | Shared icon foundation and Orbit primitives | PR 2 | Base on PR 1; add APIs/tests before consumer wiring |
| 3 | Consumer proof, guidance, and verification | PR 3 | Base on PR 2; keep product behavior unchanged |

## Phase 1: Refresh and Traceability

- [x] 1.1 Refresh `docs/open-design/kinora/` from live `kiNorA` MCP project `ceeff5f6-0930-4e48-a0b0-17a6a5c9b9ad` using the working sidecar/stdio path; update `snapshot-manifest.json`, `project.json`, `files.json`, `DESIGN.md`, `index.html`, and `screens/*.html`.
- [x] 1.2 Update `docs/open-design-kinora.md` with refresh timestamp, source evidence, and how imported screens/icons/component references stay traceable.
- [x] 1.3 Capture a short deviation note for any refreshed design detail that cannot be mirrored exactly in the app snapshot.

## Phase 2: Shared Visual Foundation

- [x] 2.1 Create `apps/web/src/components/icons/` with a typed icon registry, imported Open Design SVG wrappers, and approved library-icon adapters with consistent size and accessibility defaults.
- [x] 2.2 Create `apps/web/src/components/orbit/` primitives for card, section header, metric block, nav affordance, empty state, and CTA surface.
- [x] 2.3 Add only minimal shared CSS in `apps/web/src/app/globals.css` if a primitive cannot stay fully isolated in component styles.

## Phase 3: Proof Wiring

- [x] 3.1 Replace inline SVGs in `apps/web/src/components/AppShell/SidebarNav.tsx` and `apps/web/src/components/AppShell/MobileNav.tsx` with shared icons while preserving routes and active states.
- [x] 3.2 Reuse the new primitives/icons in `apps/web/src/components/landing/LandingHero.tsx`, `LandingFeatures.tsx`, `LandingCTA.tsx`, `LandingFooter.tsx`, `LandingHowItWorks.tsx`, `LandingPricing.tsx`, and `LandingTrust.tsx` only as proof consumers.
- [x] 3.3 Update any affected component exports/imports so AppShell and landing builds remain clean.

## Phase 4: Testing, Guidance, Cleanup

- [x] 4.1 Add Vitest coverage for `components/icons/__tests__/` and `components/orbit/__tests__/` covering icon names, sizing, `currentColor`, `aria` defaults, and primitive semantics.
- [x] 4.2 Update existing AppShell and landing tests to verify labels, links, and active-state behavior still match after the proof wiring.
- [x] 4.3 Expand `docs/open-design-kinora.md` with future-screen usage guidance, deviation-record rules, and a manual visual-verification checklist.
