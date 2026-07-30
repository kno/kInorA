# Archive Report: 14b-v1.1-adaptation-rpe-feedback

**Archived**: 2026-07-30
**Status**: Complete (one deferred manual-QA follow-up, task 8.2 — see below)

## Summary

RPE-driven plan adaptation shipped as two stacked, squash-merged PRs on top of the 14a suggest-and-confirm `/adapt` machinery:

- **PR #273 — Slice A (backend)**: `packages/contracts` (`IntensityBias`, `adjust_load` `SuggestedChange`, `RpeSnapshot`, `PlanSpec.intensityBias`), domain `computeRpeAdaptation` (pure, `WINDOW_SESSIONS=3`, hysteresis band `(5.5, 8.5)`, sample floors `MIN_SESSIONS_WITH_RPE=2`/`MIN_SETS_WITH_RPE=4`, reduce<maintain<increase ladder), `getDashboardSummary` adherence-wins fold, `updateSpecIntensityBias` repo mutation, generalized `POST /plan-specs/:id/adapt` LOAD branch (consume-before-write, fresh `randomUUID()` idempotency key, rollback-on-synchronous-throw mirroring the #244 invariant), and the generator prompt intensity-bias line.
- **PR #275 — Slice B (mobile + copy)**: mobile RPE capture (`ExerciseCard.tsx` 0-10 input, wired through `WorkoutTrackerScreen.tsx:661`), web `DashboardCoachCard` + mobile `AdherenceBanner` copy branches by `suggestedChange.kind`, and `adaptation.rpe.reduceLoad`/`increaseLoad` i18n keys (en + es, catalog-parity verified). This PR superseded an earlier auto-closed PR #274.

Both PRs are merged to `main` (per orchestrator-supplied final-state facts, ranked above the intermediate `apply-progress`/`tasks` snapshots per the Final-State Authority hierarchy). All automated suites were green at merge time: `@kinora/contracts`, `@kinora/domain`, `apps/api`, `apps/web`, `apps/mobile`, `@kinora/i18n`, plus a clean type-check across the touched packages. A pre-merge opus review verdict recorded **SAFE TO MERGE**, explicitly confirming the #244-class invariant (consume-before-write ordering, fresh `randomUUID()` idempotency key per request, rollback-on-synchronous-failure) was preserved on the new LOAD branch.

No database migration was required: `intensityBias` rides inside the existing `plan_specs.spec_json` jsonb column; absent = `"maintain"` (fully backward compatible with pre-14b specs).

## Deferred / Open Follow-up

- **Task 8.2 — Manual real-device smoke test** (full `adjust_load` accept flow, web + mobile) is explicitly **deferred to QA**, not completed as part of this cycle. This is consistent with the project's existing pattern of deferring physical-device manual smokes as tracked follow-ups (see prior deferrals #228/#245 for voice/mobile-tracker features). It is recorded here as an intentional exceptional archive per explicit orchestrator instruction — task 8.2 is the one unchecked box in `tasks.md`, and every other implementation and automated-verification task (Phases 1-8.1) is complete and merged. No GitHub issue number was supplied for 8.2 at archive time; the orchestrator/next triage sweep should file one if a formal tracking issue is wanted.

## Task Completion Gate

Per `openspec/changes/14b-v1.1-adaptation-rpe-feedback/tasks.md` (canonical, on-disk source of truth): all boxes checked except 8.2, which is the intentional deferred-QA item documented above. This satisfies the archive skill's exceptional-reconciliation bar (explicit orchestrator final-state facts + apply-progress/tasks proof that all other work is complete) — no stale unchecked implementation work is being swept under the rug.

## Native Review Receipt Gate

No structured `reviewGate`/native-review-integration transaction, ledger, or terminal receipt artifact was found for this change in Engram or on disk. The orchestrator's launch prompt instead supplied an explicit final-state fact: a pre-merge opus review with verdict **SAFE TO MERGE**, confirming the #244 invariant was preserved. This ad hoc review is recorded here as the review evidence available for this change; it is not a structured `gentle-ai review` receipt. No `verify-report` artifact was found in Engram either (search returned zero results) — the closest verification evidence is the "all suites green + type-check clean at merge" fact supplied directly by the orchestrator, ranked above any absent/lower-ranked snapshot per the Final-State Authority hierarchy.

## Delta → Main-Spec Merge

### `openspec/specs/14b-v1.1-adaptation-rpe-feedback/spec.md`
- **MODIFIED** "RPE Trend Adaptation" — replaced the old SHOULD-level, vague 6-8-zone/8-session requirement with the concrete MUST-level `computeRpeAdaptation` semantics (window=3, hysteresis band, sample floors, ladder).
- **MODIFIED (semantic replacement)** the old "Feedback Integration" requirement (MUST collect qualitative too-easy/too-hard/just-right feedback) was replaced by "RPE-Only Signal for v1 (Qualitative Feedback Deferred)", per the delta's explicit "(Previously: ...)" narrowing note. The delta file only labeled this a MODIFIED requirement (no RENAMED header), but its content and the orchestrator's launch prompt both make clear it supersedes "Feedback Integration" in place — so the old requirement text was removed and replaced rather than left standing alongside the new one (which would have left a live MUST-collect-qualitative-feedback requirement directly contradicting the new MUST-NOT).
- **ADDED** "Mobile RPE Capture" and "i18n Parity for RPE Adaptation Copy".
- **UNCHANGED** "Safe Adaptation Boundaries" (not touched by the delta, preserved as-is).

### `openspec/specs/14a-v1.1-adaptation-adherence/spec.md`
- **ADDED** "Adherence-Wins Precedence".
- **MODIFIED** "Shared Adaptation Recommendation Contract" — full-block replacement adding `adjust_load`/`RpeSnapshot` to the shared contract.
- **MODIFIED** "User Confirmation" — generalized from `reduce_frequency`-only to cover both `reduce_frequency` and `adjust_load`/`intensityBias` mutations under the same consume-before-write/fresh-key/rollback discipline.
- **REMOVED** "Frequency-Only Adjustment in Slice 1" (Reason/Migration notes present in the delta, as required) — the requirement text and its scenario were deleted outright, not left contradicting the new `adjust_load` kind.
- **UNCHANGED**: "Adherence Tracking", "Adherence-Based Recommendation", "On-Demand Read Surface", "Preserve the No-Missed Day State", "Web Adherence Suggestion Surface", "Mobile Adherence Suggestion Surface", "Coaching Tone and Internationalization", "Boundaries and Security", and the Notes section — none were touched by the delta and all are preserved verbatim.

**Self-consistency check**: after the merge, `openspec/specs/14a-v1.1-adaptation-adherence/spec.md` contains no remaining reference to "Frequency-Only Adjustment in Slice 1" and no requirement text restricts the system to frequency-only suggestions; the "Shared Adaptation Recommendation Contract" and "User Confirmation" requirements both now describe the `adjust_load`/`intensityBias` path consistently with 14b's spec. Verified by direct re-read of the merged file after edits.

## Archive Contents
- `proposal.md`
- `exploration.md`
- `design.md`
- `tasks.md`
- `specs/14b-v1.1-adaptation-rpe-feedback/spec.md` (delta, preserved for audit trail)
- `specs/14a-v1.1-adaptation-adherence/spec.md` (delta, preserved for audit trail)
- `archive-report.md` (this file)

## Engram Observation IDs (traceability)
- proposal: #2461 (`sdd/14b-v1.1-adaptation-rpe-feedback/proposal`)
- design: #2463 (`sdd/14b-v1.1-adaptation-rpe-feedback/design`)
- spec: #2464 (`sdd/14b-v1.1-adaptation-rpe-feedback/spec`)
- tasks: #2465 (`sdd/14b-v1.1-adaptation-rpe-feedback/tasks`)
- apply-progress: #2471 (`sdd/14b-v1.1-adaptation-rpe-feedback/apply-progress`)
- merge/close-out note: #2476 (manual, records PR #273/#275 merge to `main` and the stacked-PR-merge gotcha)
- verify-report: NOT FOUND in Engram (searched, zero results) — see Native Review Receipt Gate note above.

## Filesystem Operations Performed

- **Merged**: `openspec/specs/14b-v1.1-adaptation-rpe-feedback/spec.md` and `openspec/specs/14a-v1.1-adaptation-adherence/spec.md` updated in place per the delta merge above.
- **Copied to archive**: `proposal.md`, `exploration.md`, `design.md`, `tasks.md`, both delta `specs/` files, and this `archive-report.md` were written to `openspec/changes/archive/2026-07-30-14b-v1.1-adaptation-rpe-feedback/`.
- **NOT removed**: the original `openspec/changes/14b-v1.1-adaptation-rpe-feedback/` directory could not be deleted by this executor — no filesystem delete/move tool was available in this session (only Read/Edit/Write/Glob/memory tools). This is flagged as an open risk: the orchestrator (or a follow-up action with shell access) must run the equivalent of `git rm -r openspec/changes/14b-v1.1-adaptation-rpe-feedback/` (or `git mv` to the archive path, discarding this duplicate copy) to complete the move and satisfy the "active changes directory no longer has this change" archive-verification checklist item.
