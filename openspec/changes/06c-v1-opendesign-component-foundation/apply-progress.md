## Implementation Progress

**Change**: `06c-v1-opendesign-component-foundation`
**Slice**: PR 3 — proof wiring, tests, and guidance
**Mode**: Strict TDD
**Workload mode**: stacked PR slice (`stacked-to-main`)

### Completed Tasks
- [x] 1.1 Refresh local Open Design snapshot from the live `kiNorA` sidecar/stdio MCP source.
- [x] 1.2 Update refresh evidence and traceability guidance in `docs/open-design-kinora.md`.
- [x] 1.3 Record the current snapshot deviation note.
- [x] 2.1 Create `apps/web/src/components/icons/` with a typed registry and shared accessibility defaults.
- [x] 2.2 Create `apps/web/src/components/orbit/` primitives for cards, section headers, metric blocks, nav affordances, empty states, and CTA surfaces.
- [x] 2.3 Keep primitive styling isolated to component styles so `globals.css` needs no PR 2 changes.
- [x] 3.1 Replace AppShell inline SVGs with shared icons while preserving routes and active states.
- [x] 3.2 Reuse the shared icons/primitives in the assigned landing proof consumers only.
- [x] 3.3 Update affected imports/exports so AppShell and landing builds stay clean.
- [x] 4.1 Expand icon and orbit Vitest coverage for proof-wiring needs.
- [x] 4.2 Update AppShell and landing tests so labels, links, and active states remain verified after wiring.
- [x] 4.3 Expand `docs/open-design-kinora.md` with future-screen guidance, deviation rules, and manual visual verification steps.

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | N/A | Snapshot verification | N/A — artifact refresh only | ➖ Not applicable — no production behavior changed; task is a live artifact sync | ✅ `python3` snapshot metadata validation + byte-for-byte sync checks passed | ➖ Not applicable — no branching logic or behavior surface | ➖ None needed |
| 1.2 | N/A | Documentation verification | N/A — docs-only change | ➖ Not applicable — docs/provenance update only | ✅ Traceability evidence recorded in `docs/open-design-kinora.md` and re-checked after edit | ➖ Not applicable — single documentation outcome | ➖ None needed |
| 1.3 | N/A | Documentation verification | N/A — docs-only change | ➖ Not applicable — deviation note only | ✅ Deviation note recorded in `docs/open-design-kinora.md` | ➖ Not applicable — single documentation outcome | ➖ None needed |
| 2.1 | `apps/web/src/components/icons/__tests__/KinIcon.test.tsx` | Unit | N/A (new files) | ✅ Initial targeted run failed because `components/icons/index.ts` did not exist | ✅ Targeted icon/orbit suite passed after the shared icon registry and component were added | ✅ Covered decorative defaults, semantic title mode, registry-label fallback, and typed registry exposure | ✅ Simplified title handling and aligned shared React typings |
| 2.2 | `apps/web/src/components/orbit/__tests__/orbit-primitives.test.tsx` | Unit | N/A (new files) | ✅ Initial targeted run failed because `components/orbit/index.ts` did not exist | ✅ Targeted icon/orbit suite passed after the primitive exports were added | ✅ Covered section header content, metric semantics, nav-link behavior, and empty/CTA rendering | ✅ Tightened element prop contracts after type-check feedback |
| 2.3 | `apps/web/src/components/orbit/__tests__/orbit-primitives.test.tsx` | Unit | N/A (new files) | ✅ Primitive RED run established that isolated component styles had to exist before any global CSS change could be justified | ✅ Primitive tests passed while `globals.css` stayed untouched | ✅ Verified multiple primitives render correctly without any global CSS additions | ➖ Conditional task complete: no `globals.css` change was necessary |
| 3.1 | `apps/web/src/components/AppShell/__tests__/SidebarNav.test.tsx`, `apps/web/src/components/AppShell/__tests__/MobileNav.test.tsx` | Integration | ✅ Baseline targeted AppShell + landing + icon/orbit suite passed (49/49) before edits | ✅ Added shared-icon accessibility assertions first; targeted run failed because AppShell navs still rendered inline SVGs without `focusable="false"` | ✅ Targeted proof-wiring suite passed after `SidebarNav` and `MobileNav` switched to shared icons | ✅ Covered desktop nav items plus mobile tabs/FAB so the shared icon defaults could not pass on only one surface | ✅ Kept routes and `aria-current` behavior unchanged while removing duplicated SVG markup |
| 3.2 | `apps/web/src/components/landing/__tests__/LandingFeatures.test.tsx`, `LandingHowItWorks.test.tsx`, `LandingCTA.test.tsx`, `LandingTrust.test.tsx`, `LandingFooter.test.tsx` | Integration | ✅ Baseline targeted AppShell + landing + icon/orbit suite passed (49/49) before edits | ✅ Added semantic-header / CTA-surface / proof-card / shared-icon assertions first; targeted run failed across the landing proof consumers | ✅ Targeted proof-wiring suite passed after the assigned landing consumers adopted shared icons and Orbit primitives | ✅ Covered section headers, CTA structure, footer/social icons, trust cards, and preserved text content across multiple landing sections | ✅ Fixed duplicate-key noise by switching unstable message-based keys to stable proof-surface keys without changing behavior |
| 3.3 | `apps/web/src/components/AppShell/__tests__/SidebarNav.test.tsx`, `apps/web/src/components/AppShell/__tests__/MobileNav.test.tsx`, `apps/web/src/components/landing/__tests__/*.test.tsx` | Integration | ✅ Baseline targeted proof-wiring suite was already green before import/export cleanup | ✅ The same RED run from 3.1/3.2 would fail until the new shared imports compiled | ✅ Targeted suite and `pnpm --filter web type-check` passed after import/export cleanup | ➖ Triangulation skipped: structural import/export cleanup with one intended compilation outcome | ✅ Consolidated proof consumers on the existing shared surfaces only |
| 4.1 | `apps/web/src/components/icons/__tests__/KinIcon.test.tsx`, `apps/web/src/components/orbit/__tests__/orbit-primitives.test.tsx` | Unit | ✅ Baseline targeted proof-wiring suite passed after consumer wiring | ✅ Added coverage for proof-only utility icons and CTA-surface child rendering before the final verification pass | ✅ Targeted suite passed after keeping the expanded icon registry and CTA child slot aligned with the primitive contract | ✅ Covered social/utility icon reuse plus CTA decorative-child ordering as separate cases | ✅ Expanded tests without broadening the primitive API beyond proof-wiring needs |
| 4.2 | `apps/web/src/components/AppShell/__tests__/SidebarNav.test.tsx`, `MobileNav.test.tsx`, `LandingFeatures.test.tsx`, `LandingCTA.test.tsx`, `LandingFooter.test.tsx`, `LandingHowItWorks.test.tsx`, `LandingPricing.test.tsx`, `LandingTrust.test.tsx` | Integration | ✅ Baseline targeted proof-wiring suite passed before final assertion cleanup | ✅ Some updated landing assertions failed until they rendered through markup-aware checks compatible with Orbit primitives | ✅ Targeted suite passed after the tests asserted labels, links, active states, and semantic structure through rendered HTML where needed | ✅ Mixed tree-inspection and markup assertions so primitive-backed consumers and plain consumers are both covered | ✅ Removed the last warning-producing unstable list keys so verification stays clean |
| 4.3 | N/A | Documentation verification | N/A — docs-only change | ➖ Not applicable — guidance/checklist update only | ✅ `docs/open-design-kinora.md` now includes future-screen usage guidance, deviation rules, and manual visual checklist | ➖ Not applicable — single documentation outcome | ➖ None needed |

### Verification Run
- ✅ Historical PR 1 verification retained: snapshot metadata validation passed; byte-for-byte sync verification passed for the refreshed Open Design files.
- ✅ Historical PR 2 verification retained: targeted icon/orbit suite passed after shared foundations landed.
- ✅ RED: `pnpm --filter web exec vitest run src/components/AppShell/__tests__/SidebarNav.test.tsx src/components/AppShell/__tests__/MobileNav.test.tsx src/components/landing/__tests__/LandingFeatures.test.tsx src/components/landing/__tests__/LandingCTA.test.tsx src/components/landing/__tests__/LandingFooter.test.tsx src/components/landing/__tests__/LandingHowItWorks.test.tsx src/components/landing/__tests__/LandingPricing.test.tsx src/components/landing/__tests__/LandingTrust.test.tsx` failed because AppShell and landing proof consumers still used inline SVGs / non-primitive structure.
- ✅ GREEN: `pnpm --filter web exec vitest run src/components/AppShell/__tests__/SidebarNav.test.tsx src/components/AppShell/__tests__/MobileNav.test.tsx src/components/landing/__tests__/LandingHero.test.tsx src/components/landing/__tests__/LandingFeatures.test.tsx src/components/landing/__tests__/LandingCTA.test.tsx src/components/landing/__tests__/LandingFooter.test.tsx src/components/landing/__tests__/LandingHowItWorks.test.tsx src/components/landing/__tests__/LandingPricing.test.tsx src/components/landing/__tests__/LandingTrust.test.tsx src/components/icons/__tests__/KinIcon.test.tsx src/components/orbit/__tests__/orbit-primitives.test.tsx` passed (59 tests).
- ✅ REFACTOR safety: `pnpm --filter web type-check` passed after widening `KinIcon` size support and hardening message/indexed-access fallbacks.
- ✅ Broader feasible check: `pnpm --filter web test` passed (162 tests).
- ✅ Follow-up regression check: `pnpm --filter web test` passed again after replacing unstable message-derived list keys in landing proof consumers.
- ➖ Root `pnpm test`, `pnpm architecture`, `pnpm deps-guard`, and `pnpm build` were not run in apply; they remain verify-phase guards for the full repository.

### Files Changed
| File | Action | Notes |
|------|--------|-------|
| `docs/open-design/kinora/snapshot-manifest.json` | Modified | Recorded fresh pull timestamp, sidecar retrieval details, and traceability inventory |
| `docs/open-design/kinora/project.json` | Modified | Synced live Open Design project metadata including `entryFile` and preview evidence |
| `docs/open-design/kinora/files.json` | Modified | Synced live inventory metadata, including new `icons.html` artifact |
| `docs/open-design/kinora/index.html` | Modified | Refreshed local overview artifact from live source |
| `docs/open-design/kinora/icons.html` | Created | Added imported icon library and Orbit logo reference page from live source |
| `docs/open-design/kinora/screens/*.html` | Modified | Refreshed all tracked screen snapshots from live source |
| `docs/open-design-kinora.md` | Modified | Added future-screen guidance, deviation rules, and manual visual verification checklist |
| `package.json` | Modified | Removed accidental `od:mcp` root package script so PR 1 scope stays snapshot/docs only |
| `apps/web/src/components/icons/KinIcon.tsx` | Modified | Expanded the shared icon registry for proof consumers and applied shared SVG class/default behavior |
| `apps/web/src/components/icons/index.ts` | Created | Exported the shared icon foundation API |
| `apps/web/src/components/icons/__tests__/KinIcon.test.tsx` | Modified | Added proof-wiring coverage for utility/social icon reuse |
| `apps/web/src/components/orbit/OrbitCard.tsx` | Created | Reusable Orbit card primitive |
| `apps/web/src/components/orbit/OrbitSectionHeader.tsx` | Created | Reusable Orbit section header primitive |
| `apps/web/src/components/orbit/OrbitMetricBlock.tsx` | Created | Reusable Orbit metric block primitive |
| `apps/web/src/components/orbit/OrbitNavAffordance.tsx` | Created | Reusable Orbit nav affordance primitive |
| `apps/web/src/components/orbit/OrbitEmptyState.tsx` | Created | Reusable Orbit empty-state primitive |
| `apps/web/src/components/orbit/OrbitCtaSurface.tsx` | Modified | Added CTA child-slot support for decorative proof content |
| `apps/web/src/components/orbit/orbit-primitives.module.css` | Created | Isolated primitive styling without touching global CSS |
| `apps/web/src/components/orbit/index.ts` | Created | Exported the Orbit primitive surface for consumer wiring |
| `apps/web/src/components/orbit/__tests__/orbit-primitives.test.tsx` | Modified | Added CTA child-slot coverage alongside semantic primitive assertions |
| `apps/web/src/components/AppShell/SidebarNav.tsx` | Modified | Replaced inline nav SVGs with shared icons while preserving active-route behavior |
| `apps/web/src/components/AppShell/MobileNav.tsx` | Modified | Replaced inline tab/FAB SVGs with shared icons while preserving tab routes and active states |
| `apps/web/src/components/AppShell/__tests__/SidebarNav.test.tsx` | Modified | Added shared-icon accessibility regression coverage |
| `apps/web/src/components/AppShell/__tests__/MobileNav.test.tsx` | Modified | Added shared-icon accessibility regression coverage for tabs and FAB |
| `apps/web/src/components/landing/LandingHero.tsx` | Modified | Reused shared icons in hero eyebrow, CTA, metadata, avatar, and workout checks |
| `apps/web/src/components/landing/LandingFeatures.tsx` | Modified | Reused `OrbitSectionHeader`, `OrbitCard`, and shared icons for the feature proof surface |
| `apps/web/src/components/landing/LandingCTA.tsx` | Modified | Reused `OrbitCtaSurface` for the CTA proof surface |
| `apps/web/src/components/landing/LandingFooter.tsx` | Modified | Reused shared Orbit/social icons in the footer proof surface |
| `apps/web/src/components/landing/LandingHowItWorks.tsx` | Modified | Reused `OrbitSectionHeader`, `OrbitCard`, and shared icons for the step proof surface |
| `apps/web/src/components/landing/LandingPricing.tsx` | Modified | Reused `OrbitSectionHeader`, `OrbitCard`, and shared icons for the pricing proof surface |
| `apps/web/src/components/landing/LandingTrust.tsx` | Modified | Reused `OrbitCard` and shared icons for semantic trust proof cards |
| `apps/web/src/components/landing/__tests__/LandingFeatures.test.tsx` | Modified | Added semantic section-header coverage |
| `apps/web/src/components/landing/__tests__/LandingCTA.test.tsx` | Modified | Added semantic CTA-surface coverage |
| `apps/web/src/components/landing/__tests__/LandingFooter.test.tsx` | Modified | Added shared footer-icon coverage |
| `apps/web/src/components/landing/__tests__/LandingHowItWorks.test.tsx` | Modified | Added semantic section-header coverage |
| `apps/web/src/components/landing/__tests__/LandingPricing.test.tsx` | Modified | Added semantic section-header coverage |
| `apps/web/src/components/landing/__tests__/LandingTrust.test.tsx` | Modified | Added semantic proof-card coverage |
| `openspec/changes/06c-v1-opendesign-component-foundation/tasks.md` | Modified | Marked Phase 3 and Phase 4 tasks complete |
| `openspec/changes/06c-v1-opendesign-component-foundation/apply-progress.md` | Modified | Merged cumulative PR 1 + PR 2 + PR 3 implementation evidence |

### Deviations from Design
None. The proof wiring stayed within the existing shared icon/orbit foundation and did not introduce new product behavior.

### Remaining Tasks
- None — apply scope for PR 3 is complete.

### Rollback Notes
- Revert PR 3 consumer/test/doc updates to return AppShell and landing proof consumers to their pre-foundation inline/icon structure.
- If a full rollback is needed, revert PR 1 snapshot/docs files plus the PR 2 foundation files and this artifact.

### PR Boundary
- **Mode**: stacked PR slice
- **Current unit**: PR 3 — proof wiring, guidance, and verification cleanup
- **Depends on**: PR 1 snapshot refresh commit `159c9cc docs(open-design): refresh kinora snapshot`; PR 2 foundation commit `050012d feat(web): add orbit component foundation`
- **Next slice**: verify/archive only
