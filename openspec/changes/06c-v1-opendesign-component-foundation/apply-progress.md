## Implementation Progress

**Change**: `06c-v1-opendesign-component-foundation`
**Slice**: PR 2 — shared icon foundation and Orbit primitives
**Mode**: Strict TDD
**Workload mode**: stacked PR slice (`stacked-to-main`)

### Completed Tasks
- [x] 1.1 Refresh local Open Design snapshot from the live `kiNorA` sidecar/stdio MCP source.
- [x] 1.2 Update refresh evidence and traceability guidance in `docs/open-design-kinora.md`.
- [x] 1.3 Record the current snapshot deviation note.
- [x] 2.1 Create `apps/web/src/components/icons/` with a typed registry and shared accessibility defaults.
- [x] 2.2 Create `apps/web/src/components/orbit/` primitives for cards, section headers, metric blocks, nav affordances, empty states, and CTA surfaces.
- [x] 2.3 Keep primitive styling isolated to component styles so `globals.css` needs no PR 2 changes.

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | N/A | Snapshot verification | N/A — artifact refresh only | ➖ Not applicable — no production behavior changed; task is a live artifact sync | ✅ `python3` snapshot metadata validation + byte-for-byte sync checks passed | ➖ Not applicable — no branching logic or behavior surface | ➖ None needed |
| 1.2 | N/A | Documentation verification | N/A — docs-only change | ➖ Not applicable — docs/provenance update only | ✅ Traceability evidence recorded in `docs/open-design-kinora.md` and re-checked after edit | ➖ Not applicable — single documentation outcome | ➖ None needed |
| 1.3 | N/A | Documentation verification | N/A — docs-only change | ➖ Not applicable — deviation note only | ✅ Deviation note recorded in `docs/open-design-kinora.md` | ➖ Not applicable — single documentation outcome | ➖ None needed |
| 2.1 | `apps/web/src/components/icons/__tests__/KinIcon.test.tsx` | Unit | N/A (new files) | ✅ Wrote icon tests first; the initial targeted run failed because `components/icons/index.ts` did not exist | ✅ `pnpm --filter web exec vitest run src/components/icons/__tests__/KinIcon.test.tsx src/components/orbit/__tests__/orbit-primitives.test.tsx` passed with 4 icon assertions | ✅ Covered decorative defaults, semantic title mode, registry-label fallback, and typed registry exposure | ✅ Simplified title handling and aligned shared React typings after `pnpm --filter web type-check` |
| 2.2 | `apps/web/src/components/orbit/__tests__/orbit-primitives.test.tsx` | Unit | N/A (new files) | ✅ Wrote primitive tests first; the initial targeted run failed because `components/orbit/index.ts` did not exist | ✅ `pnpm --filter web exec vitest run src/components/icons/__tests__/KinIcon.test.tsx src/components/orbit/__tests__/orbit-primitives.test.tsx` passed with 4 primitive assertions | ✅ Covered section header content, metric semantics, nav-link behavior, and empty/CTA rendering without product behavior | ✅ Tightened element prop contracts after `pnpm --filter web type-check` surfaced JSX typing mismatches |
| 2.3 | `apps/web/src/components/orbit/__tests__/orbit-primitives.test.tsx` | Unit | N/A (new files) | ✅ The first primitive RED run established that isolated component styles had to exist before any global CSS change could be justified | ✅ Primitive tests pass and `apps/web/src/app/globals.css` stayed untouched because the components remain self-contained in CSS modules | ✅ Verified multiple primitives render correctly without any global CSS additions | ➖ Conditional task complete: no `globals.css` change was necessary |

### Verification Run
- ✅ `python3` snapshot metadata validation passed (`snapshot-manifest.json`, `project.json`, `files.json`, required local files)
- ✅ `python3` byte-for-byte sync verification passed for 15 copied live source files
- ✅ Live source access verified through the sidecar stdio MCP path (`get_project` and `list_files`)
- ✅ Corrective pass removed the stray `od:mcp` package script so PR 1 remains snapshot/docs only
- ✅ Corrective pass aligned `snapshot-manifest.json` with `files.json` for `assets/kinora.css`
- ✅ RED: `pnpm --filter web test -- src/components/icons/__tests__/KinIcon.test.tsx src/components/orbit/__tests__/orbit-primitives.test.tsx` failed because the new icon/orbit exports did not exist yet
- ✅ GREEN: `pnpm --filter web exec vitest run src/components/icons/__tests__/KinIcon.test.tsx src/components/orbit/__tests__/orbit-primitives.test.tsx` passed
- ✅ REFACTOR safety: `pnpm --filter web type-check` passed after aligning shared React prop typing
- ✅ Broader feasible check: `pnpm --filter web test` passed (149 tests)
- ✅ Corrective RED: `pnpm --filter web exec vitest run src/components/icons/__tests__/KinIcon.test.tsx src/components/orbit/__tests__/orbit-primitives.test.tsx` failed because `createLibraryIconEntry` was missing and `OrbitEmptyState` / `OrbitCtaSurface` rendered `<article>` instead of `<section>`
- ✅ Corrective GREEN: `pnpm --filter web exec vitest run src/components/icons/__tests__/KinIcon.test.tsx src/components/orbit/__tests__/orbit-primitives.test.tsx` passed with the strengthened semantic and adapter-contract assertions (9 tests)
- ✅ Corrective REFACTOR safety: `pnpm --filter web type-check` passed after exporting explicit library-adapter entry types and helpers
- ✅ Corrective verification: `pnpm --filter web exec vitest run src/components/icons/__tests__/KinIcon.test.tsx src/components/orbit/__tests__/orbit-primitives.test.tsx` now passes with separate root-tag assertions for `OrbitEmptyState` and `OrbitCtaSurface` (11 tests)
- ✅ Corrective verification safety: `pnpm --filter web type-check` passed after strengthening the Orbit primitive root-tag assertions
- ⚠️ Existing unrelated warning remains in `src/app/__tests__/page.test.tsx`: React reports missing list keys in `LandingFeatures`, but the suite stays green and PR 2 did not touch that area
- ➖ Root `pnpm test`, `pnpm architecture`, `pnpm deps-guard`, and `pnpm build` were not run in apply because this slice only adds isolated web components/tests; broader repository validation belongs in verify

### Files Changed
| File | Action | Notes |
|------|--------|-------|
| `docs/open-design/kinora/snapshot-manifest.json` | Modified | Recorded fresh pull timestamp, sidecar retrieval details, and traceability inventory |
| `docs/open-design/kinora/project.json` | Modified | Synced live Open Design project metadata including `entryFile` and preview evidence |
| `docs/open-design/kinora/files.json` | Modified | Synced live inventory metadata, including new `icons.html` artifact |
| `docs/open-design/kinora/index.html` | Modified | Refreshed local overview artifact from live source |
| `docs/open-design/kinora/icons.html` | Created | Added imported icon library and Orbit logo reference page from live source |
| `docs/open-design/kinora/screens/*.html` | Modified | Refreshed all tracked screen snapshots from live source |
| `docs/open-design-kinora.md` | Modified | Added refresh timestamp, sidecar evidence, traceability rules, and deviation note |
| `package.json` | Modified | Removed accidental `od:mcp` root package script so PR 1 scope stays snapshot/docs only |
| `apps/web/src/components/icons/KinIcon.tsx` | Created | Added typed Open Design-backed icon registry, shared `KinIcon`, and named wrappers |
| `apps/web/src/components/icons/index.ts` | Created | Exported the shared icon foundation API |
| `apps/web/src/components/icons/__tests__/KinIcon.test.tsx` | Created | Added strict-TDD coverage for icon sizing, semantics, and registry reuse |
| `apps/web/src/components/orbit/OrbitCard.tsx` | Created | Added reusable Orbit card primitive |
| `apps/web/src/components/orbit/OrbitSectionHeader.tsx` | Created | Added reusable Orbit section header primitive |
| `apps/web/src/components/orbit/OrbitMetricBlock.tsx` | Created | Added reusable Orbit metric block primitive |
| `apps/web/src/components/orbit/OrbitNavAffordance.tsx` | Created | Added reusable Orbit nav affordance primitive |
| `apps/web/src/components/orbit/OrbitEmptyState.tsx` | Created | Added reusable Orbit empty-state primitive |
| `apps/web/src/components/orbit/OrbitCtaSurface.tsx` | Created | Added reusable Orbit CTA surface primitive |
| `apps/web/src/components/orbit/orbit-primitives.module.css` | Created | Isolated primitive styling without touching global CSS |
| `apps/web/src/components/orbit/index.ts` | Created | Exported the Orbit primitive surface for future proof wiring |
| `apps/web/src/components/orbit/__tests__/orbit-primitives.test.tsx` | Created | Added strict-TDD coverage for Orbit primitive semantics and link behavior |
| `openspec/changes/06c-v1-opendesign-component-foundation/tasks.md` | Modified | Marked Phase 2 tasks complete |
| `openspec/changes/06c-v1-opendesign-component-foundation/apply-progress.md` | Modified | Merged cumulative PR 1 + PR 2 implementation evidence |

### Corrective Pass TDD Evidence
| Warning | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---------|-----------|-------|------------|-----|-------|-------------|----------|
| Orbit semantic mismatch | `apps/web/src/components/orbit/__tests__/orbit-primitives.test.tsx` | Unit | ✅ Baseline targeted orbit/icon suite passed (8/8) before edits | ✅ Added assertions for `<section>` wrappers before code changes; targeted run failed because both primitives still rendered `<article>` through `OrbitCard` defaults | ✅ `pnpm --filter web exec vitest run src/components/icons/__tests__/KinIcon.test.tsx src/components/orbit/__tests__/orbit-primitives.test.tsx` passed after forcing `as="section"` in `OrbitEmptyState` and `OrbitCtaSurface` | ✅ The same test still asserts `<article>` for the standalone card so section-only fixes could not pass trivially | ➖ No further refactor needed beyond preserving semantic intent |
| Library-icon adapter capability explicit | `apps/web/src/components/icons/__tests__/KinIcon.test.tsx` | Unit | ✅ Baseline targeted orbit/icon suite passed (8/8) before edits | ✅ Added a future-adapter contract test first; targeted run failed because `createLibraryIconEntry` was not exported yet | ✅ `pnpm --filter web exec vitest run src/components/icons/__tests__/KinIcon.test.tsx src/components/orbit/__tests__/orbit-primitives.test.tsx` passed after exporting explicit `library` entry metadata and helper API | ➖ Triangulation skipped: this was a structural contract/export task with one intended metadata shape and no runtime branching | ✅ `pnpm --filter web type-check` confirmed the exported helper/types remain aligned |
| Orbit root-tag assertion specificity | `apps/web/src/components/orbit/__tests__/orbit-primitives.test.tsx` | Unit | ✅ Baseline targeted orbit/icon suite passed (11/11) before edits | ✅ Replaced the shared combined section assertion with separate per-primitive root assertions before re-running verification | ✅ `pnpm --filter web exec vitest run src/components/icons/__tests__/KinIcon.test.tsx src/components/orbit/__tests__/orbit-primitives.test.tsx` passed with dedicated `<section>` checks for both primitives | ✅ Kept a standalone `OrbitCard` `<article>` assertion so the strengthened checks prove each primitive root independently | ➖ Test-only corrective pass; no production refactor needed |

### Deviations from Design
None for PR 2. The foundation matches the design goal of Open Design-backed icons and isolated Orbit primitives; library-icon adapters were intentionally deferred because no approved icon library dependency exists in `apps/web/package.json`.

### Remaining Tasks
- [ ] 3.1 Replace AppShell inline SVGs with shared icons
- [ ] 3.2 Reuse primitives/icons in landing proof consumers only
- [ ] 3.3 Update affected exports/imports so proof consumers build cleanly
- [ ] 4.1 Add Vitest coverage for icons and orbit primitives
- [ ] 4.2 Update existing AppShell and landing tests after proof wiring
- [ ] 4.3 Expand `docs/open-design-kinora.md` with future-screen usage guidance and manual visual checklist

### Rollback Notes
- Revert PR 1 snapshot/docs files plus the new `apps/web/src/components/icons/` and `apps/web/src/components/orbit/` files, `tasks.md`, and this apply-progress artifact.
- No product behavior changed in PR 2; removing the new shared foundations returns the app to its pre-foundation inline-icon/component state.

### Corrective Pass Notes
- Removed the accidental `od:mcp` root package script so this stacked PR slice stays within the approved snapshot/docs boundary.
- Added `assets/kinora.css` to `snapshot-manifest.json` because it already exists in the local snapshot inventory (`files.json`) and should remain traceable with the rest of the imported artifact set.
- Adjusted the new shared React prop types after `pnpm --filter web type-check` surfaced JSX namespace mismatches; no behavior changed and the targeted tests stayed green.
- Resolved the verification warning about section semantics by forcing `OrbitEmptyState` and `OrbitCtaSurface` to render `OrbitCard` as `<section>` while leaving `OrbitCard` itself defaulted to `<article>`.
- Made future approved library-icon adapters explicit in the icon API by exporting a `library` registry entry shape plus `createLibraryIconEntry`, without adding any third-party dependency.
- Strengthened `orbit-primitives.test.tsx` so `OrbitEmptyState` and `OrbitCtaSurface` each prove their own `<section>` root independently instead of relying on a shared combined assertion.

### PR Boundary
- **Mode**: stacked PR slice
- **Current unit**: PR 2 — shared icon foundation and Orbit primitives only
- **Depends on**: PR 1 snapshot refresh commit `159c9cc docs(open-design): refresh kinora snapshot`
- **Next slice**: PR 3 proof wiring, guidance, and follow-up verification/docs
