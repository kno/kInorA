# Archive Report: 100-i18n-icu-adoption

**Archived**: 2026-07-16
**Change**: 100-i18n-icu-adoption
**Archive folder**: `openspec/changes/archive/2026-07-16-100-i18n-icu-adoption/`
**Status**: complete — **ARCHIVED (PASS-WITH-NOTES)**

## Verdict

Verify phase (Engram #1876, `verify-report.md`) returned **PASS-WITH-NOTES**:
0 critical, 0 warning findings; full workspace test suite green (159 files /
1506 tests); `pnpm -r type-check` clean across all 6 workspace projects. The
2 notes are explicitly deferred device/visual validations (below), not
code-completeness gaps — see Outstanding section.

## Delivery: 10 Stacked-to-Main Slices

All 10 slices from `tasks.md` merged to `main` (final HEAD `4e26add`),
each independently green and reviewed:

| # | Slice | PR |
|---|-------|-----|
| 1 | `@kinora/i18n` machinery (flatten, mergeWithBase, parity/ICU-arg guard, type-gen) | #102 |
| 2 | Catalog migration (325 flat→nested keys, 18 ICU) | #103 |
| 3 | Web foundation (proxy `?lang=`→header, `getRequestConfig`, next-intl wiring) | #104 |
| 4 | Tracker subtree (shared) migration | #105 |
| 5 | Plan shell migration (+ `select`/`useFormatter` date on `PlanSelector`) | #106 |
| 6 | Wizard + create-plan migration | #107 |
| 7 | Web cluster C: app-level pages (8 orphan pages + 7 landing children) | #108 |
| 8 | Web cleanup — point of no return (old JSON/`loadMessages`/`resolvePageI18n` retired) | #109 |
| 9 | Mobile foundation + ~23 mobile-unique tracker strings authored | #110 |
| 10 | Mobile tracker migration (WorkoutTrackerScreen + components off `trackerCopy`) | #111, #112, #115, #116 |

(PR range per team-lead brief: #102–#112, #115, #116; slice 10 was split
across multiple PRs during review due to the `WorkoutTrackerScreen`
decomposition raised in review.)

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `100a-shared-i18n-catalog` | Created | New spec; no prior main spec existed — delta specs ARE the full spec (verbatim copy) |
| `100b-web-i18n-runtime` | Created | New spec; same as above |
| `100c-mobile-i18n-runtime` | Created | New spec; same as above |

**Main specs created**:
- `openspec/specs/100a-shared-i18n-catalog/spec.md`
- `openspec/specs/100b-web-i18n-runtime/spec.md`
- `openspec/specs/100c-mobile-i18n-runtime/spec.md`

No existing i18n spec previously existed in `openspec/specs/` (confirmed by
directory listing before archive) — this change's delta specs are the full,
final capability specs, so they were copied verbatim rather than diffed
against a prior version.

## Archive Contents

- `proposal.md` ✅ (Success Criteria checkboxes updated `[ ]` → `[x]`, all 6 met per verify report)
- `specs/100a-shared-i18n-catalog/spec.md` ✅
- `specs/100b-web-i18n-runtime/spec.md` ✅
- `specs/100c-mobile-i18n-runtime/spec.md` ✅
- `design.md` ✅ (rev3; Open Questions section resolved — Turbopack header propagation VALIDATED, Hermes plural check left open/deferred to #117)
- `tasks.md` ✅ (all items `[x]` except 10.4.1/10.4.2, correctly left `[ ]` with NOT-VALIDATED markers, cross-referenced to #117)
- `verify-report.md` ✅ (PASS-WITH-NOTES, full detail preserved)
- `archive-report.md` ✅ (this file)

## Task Completion

All 10 slices complete; every checklist item in `tasks.md` is `[x]` **except**:

- **10.4.1** — Hermes on-device `Intl.PluralRules` ES plural-branch validation (RN 0.79.5). Cannot be exercised headlessly; a Vitest/Node run does not substitute for a real Hermes engine check.
- **10.4.2** — Polyfill decision (`@formatjs/intl-pluralrules` + `@formatjs/intl-locale`), gated on 10.4.1's outcome. Code currently ships the design's no-polyfill default, UNCONFIRMED as correct.

## OUTSTANDING — Deferred Items (tracked in issue #117)

These are **apply-time/device validations by design**, not implementation
gaps. The merged code, full test suite (1506 tests), and type-check are all
green without them:

1. **Hermes on-device plural validation (10.4.1)** — needs a real device/simulator run of `tracker.next.sets` (or any ES plural key) under RN 0.79.5 Hermes to confirm `Intl.PluralRules` selects the correct branch for count=1 and count=3.
2. **Polyfill decision (10.4.2)** — gated on (1); if Hermes native output is wrong, add `@formatjs/intl-pluralrules` + `@formatjs/intl-locale` and re-validate.
3. **Mobile tracker visual-parity eyeball** — a manual/visual check of the tracker screen post-`WorkoutTrackerScreen` decomposition (PR #116), not a code-completeness item.

**Issue #117** tracks all three; this archive does not close them — they
remain open follow-up work outside the scope of a headless SDD apply/verify
cycle.

## Engram Traceability

| Phase | Observation ID | Topic key |
|-------|----------------|-----------|
| Proposal | #1833 | `sdd/100-i18n-icu-adoption/proposal` |
| Spec (delta) | #1834 | `sdd/100-i18n-icu-adoption/spec` |
| Design (rev3) | #1836 | `sdd/100-i18n-icu-adoption/design` |
| Tasks (rev3) | #1846 | `sdd/100-i18n-icu-adoption/tasks` |
| Verify report | #1876 | `sdd/100-i18n-icu-adoption/verify-report` |
| Archive report | (this save) | `sdd/100-i18n-icu-adoption/archive-report` |

## SDD Cycle Complete

The change has been fully planned (proposal → spec → design rev3), applied
(10 stacked PRs, strict TDD RED/GREEN throughout), verified
(PASS-WITH-NOTES, 1506 tests green), and archived. The only remaining work
is the two explicitly-flagged, non-code-blocking Hermes device validations
and one manual visual check, all tracked in issue #117.
