# Archive Report: 06b-v1-orbit-ui-shell

**Archived**: 2026-06-26
**Archived to**: `openspec/changes/archive/2026-06-26-06b-v1-orbit-ui-shell/`
**Artifact store**: hybrid (openspec files + Engram observation #1631 for verify-report)
**Verdict at archive**: PASS WITH WARNINGS — no CRITICAL issues

---

## SDD Cycle Summary

| Phase | Status | Notes |
|-------|--------|-------|
| Exploration | Complete | exploration.md — gap analysis vs. Open Design snapshot |
| Proposal | Complete | proposal.md — 4 capabilities, 3-PR delivery plan |
| Design | Complete | design.md — AppShell architecture, CSS modules, file change table |
| Tasks | Complete | tasks.md — 25 tasks, 3 phases, all [x] |
| Apply | Complete | 3 chained PRs merged to main (stacked-to-main strategy) |
| Verify | PASS WITH WARNINGS | verify-report.md — 0 CRITICAL, 3 WARNING, 3 SUGGESTION |
| Archive | Complete | This report |

---

## Completeness at Archive

| Metric | Value |
|--------|-------|
| Tasks total | 25 |
| Tasks complete | 25/25 (100%) |
| Tasks incomplete | 0 |
| CRITICAL issues | 0 |
| WARNING issues | 3 (non-blocking) |
| SUGGESTION items | 3 (informational) |

All 25 tasks confirmed `[x]` in tasks.md before archive. Task Completion Gate passed.

---

## Spec Delta Merge

**No spec delta folder** (`openspec/changes/06b-v1-orbit-ui-shell/specs/` does not exist).

This change introduced new capabilities (`orbit-design-system`, `landing-page`, `app-shell`, `screen-scaffolds`) but did not produce a structured spec delta for merge into `openspec/specs/`. The proposal classified all modified capabilities as "None — auth proxy matcher additions are implementation-only."

**Spec merge step: SKIPPED** — no delta to merge. No spec files under `openspec/specs/` were modified.

---

## Archive Contents

| File | Status |
|------|--------|
| `proposal.md` | ✅ Archived |
| `exploration.md` | ✅ Archived |
| `design.md` | ✅ Archived |
| `tasks.md` | ✅ Archived (25/25 tasks complete) |
| `verify-report.md` | ✅ Archived |
| `archive-report.md` | ✅ This file |

---

## Engram Observations (Traceability)

| Artifact | Engram Observation ID | Notes |
|----------|----------------------|-------|
| verify-report | #1631 | Full verify-report persisted in Engram |
| apply-progress | #1560 | Architectural note in Engram (not structured TDD table — see W1 below) |
| Other artifacts | File-only | proposal, exploration, design, tasks were openspec-only |

---

## Carried-Forward Warnings

These non-blocking warnings from verify-report are carried into the archive record for future reference:

### W1 — Apply-progress missing TDD Cycle Evidence table (process gap)
The apply phase used Engram architectural notes (observation #1560) instead of the structured `## TDD Cycle Evidence` table required by Strict TDD protocol. The implementation is correct and all 383 tests pass, but the process evidence trail is incomplete. **Recommended action**: future apply phases on this project should produce the full TDD Cycle Evidence table in the apply-progress artifact.

### W2 — Redundant `toBeDefined()` in AppShell.test.tsx (code smell, low risk)
`AppShell.test.tsx` lines 75 and 78 use `expect(screen.getByRole/getByText(...)).toBeDefined()`. Both `getByRole` and `getByText` throw when the element is not found, making `.toBeDefined()` a no-op. **Recommended action**: replace with `not.toBeNull()` or a value assertion in a future test-quality pass.

### W3 — CSS-only behaviors not directly tested (coverage gap, low risk)
Safe-area padding (`padding-bottom` in MobileNav) and mobile max-width are implemented in CSS modules but have no corresponding test. Build passes and the component structure is verified. **Recommended action**: addressable when Playwright E2E infra is added (see S2 below).

---

## Carried-Forward Suggestions

### S1 — Coverage threshold not configured
The project has `test:coverage` in root package.json but no threshold gate. Adding a `coverage_threshold` would formalize verification coverage across changed files.

### S2 — Playwright E2E infrastructure needed
Tasks 06B-TST 1.8 (viewport tests) and 06B-TST 2.7 (authenticated navigation) were intentionally degraded to Vitest integration tests because Playwright is not installed. The gap is documented. The next change that establishes Playwright infra should backfill these scenarios.

### S3 — MobileNav tab list diverges from design narrative
Design doc specifies "Home/Plan/Create(+)/Stats/Profile" as the five tabs. Implementation has Home/Plan/Stats/Exercises (4 tabs) + FAB (Create Plan). Profile is not a tab. This matches the code and tasks but differs from the design's explicit tab list. Low risk — it reflects the current implementation intent. Worth revisiting when the Profile feature is built.

---

## Implementation Footprint

### New Files Created
- `apps/web/src/components/AppShell/AppShell.tsx` + `AppShell.module.css`
- `apps/web/src/components/AppShell/SidebarNav.tsx` + `SidebarNav.module.css`
- `apps/web/src/components/AppShell/MobileNav.tsx` + `MobileNav.module.css`
- `apps/web/src/components/AppShell/nav-utils.ts`
- `apps/web/src/components/landing/LandingNav.tsx`
- `apps/web/src/components/landing/LandingHero.tsx`
- `apps/web/src/components/landing/LandingTrust.tsx`
- `apps/web/src/components/landing/LandingHowItWorks.tsx`
- `apps/web/src/components/landing/LandingFeatures.tsx`
- `apps/web/src/components/landing/LandingPricing.tsx`
- `apps/web/src/components/landing/LandingCTA.tsx`
- `apps/web/src/components/landing/LandingFooter.tsx`
- `apps/web/src/app/(app)/layout.tsx`
- `apps/web/src/app/(app)/dashboard/page.tsx`
- `apps/web/src/app/(app)/plan/page.tsx`
- `apps/web/src/app/(app)/stats/page.tsx`
- `apps/web/src/app/(app)/create-plan/page.tsx`
- `apps/web/src/app/(app)/exercises/page.tsx`
- `apps/web/src/app/(app)/profile/page.tsx`
- Test files for all of the above (Vitest + @testing-library/react)

### Modified Files
- `apps/web/src/app/globals.css` — `--accent-dim` token + landing section CSS classes
- `apps/web/src/app/page.tsx` — full landing page (8 sections)
- `apps/web/src/i18n/messages/en.json` — expanded from 3 to 97 keys
- `apps/web/src/proxy.ts` — `/stats`, `/create-plan`, `/exercises` added to matcher
- `apps/web/src/app/offline/page.tsx` — migrated to `kin-*` CSS classes

### Deleted Files
- `apps/web/src/app/dashboard/page.tsx` — migrated to `(app)/dashboard/page.tsx`

### Delivery
- 3 chained PRs merged to main (`stacked-to-main` strategy)
- All PRs under 400-line budget per slice

---

## Test Results at Archive

| Suite | Tests | Result |
|-------|-------|--------|
| apps/web | 162 | ✅ ALL PASS |
| apps/api | 158 | ✅ ALL PASS |
| packages/domain | 22 | ✅ ALL PASS |
| packages/contracts | 7 | ✅ ALL PASS |
| apps/mobile | 34 | ✅ ALL PASS |
| **Grand total** | **383** | **✅ ALL PASS** |

Build: ✅ | Type-check: ✅ | deps-guard: ✅ | architecture: ✅

---

## Source Paths for Orchestrator to Remove

The orchestrator must run `git rm -r` on these paths to complete the move (archive copies are written):

```
openspec/changes/06b-v1-orbit-ui-shell/
```

Single `git rm -r openspec/changes/06b-v1-orbit-ui-shell/` removes all 5 source files:
- `openspec/changes/06b-v1-orbit-ui-shell/proposal.md`
- `openspec/changes/06b-v1-orbit-ui-shell/exploration.md`
- `openspec/changes/06b-v1-orbit-ui-shell/design.md`
- `openspec/changes/06b-v1-orbit-ui-shell/tasks.md`
- `openspec/changes/06b-v1-orbit-ui-shell/verify-report.md`

---

## SDD Cycle Complete

Change `06b-v1-orbit-ui-shell` has been fully planned, implemented, verified, and archived. The Orbit brand is applied: landing page, AppShell (sidebar + mobile nav), auth-aware route group, scaffold pages, proxy matcher, and i18n keys are all live in `main`. Ready for the next change.
