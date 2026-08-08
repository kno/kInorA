# Archive Report — 17c-profile-body-metrics

**Archived**: 2026-08-08  
**Status**: COMPLETE, MERGED AND DEPLOYED  
**Verification**: PASS WITH WARNINGS (2026-08-08)

## Change Summary

17c extended the user profile system to capture physiological body metrics (sex/gender identity, height, and a dated bodyweight series), integrated these metrics into plan generation with robust privacy controls, and updated volume calculations to include bodyweight-only sets. Five chained PRs (#384–#388) delivered the complete change across web and mobile platforms.

**GitHub Issue**: [kno/kInorA#361](https://github.com/kno/kInorA/issues/361)

## Scope and Outcomes

### In Scope — Delivered

**A1: Web Profile Scalars** (`selfDescribedSex` + `heightCm`)
- New nullable enum field (five values: female, male, non_binary, other, prefer_not_to_say)
- Threading through seven layers: schema, migration, contracts, API route, repository, web form, i18n
- PR #384 (291 non-test lines)

**A2: Bodyweight Series** (`user_weight_entries`)
- New 1:many table (no unique constraint on userId — deliberate)
- GET/POST routes with server-computed `wasFirstEntry` flag
- Web entry form and read-only reverse-chronological list
- Integration test added to CI pipeline in the same commit
- PR #385 (680 non-test lines)

**B: Trace Redaction + Prompt Rendering**
- General span-redaction engine (`TraceRedactionRule`, `redactSpans`, `redactTracedPayload`)
- Wired as Langfuse `CallbackHandler` `mask` option — separates model input from trace input for the first time
- Body metrics rendered into prompt via `{{bodyProfileSection}}` marker
- Byte-identical degradation when body data absent
- Three-layer privacy enforcement: SDK hook, span redaction, fail-closed backstop
- PR #386 (461 non-test lines)

**C1: Bodyweight Volume Resolution**
- Pure domain function `resolveBodyweightForSession` (nearest-at-or-before, falling back to earliest)
- One resolved bodyweight carried on `WorkoutSessionRecord`
- Applied consistently across three volume computation sites (domain, API, web tracker)
- PR #387 (334 non-test lines)

**C2: Volume-Shift Communication**
- User-visible notice on first weight entry: "Your past totals have changed. Bodyweight sets now count toward your training volume, so figures from before today are not directly comparable."
- Dismissible, not persisted (appears once per account)
- Scoped to first weight entry only (per resolved question round)
- PR #387

**A3: Mobile Profile Screen** (Greenfield)
- New profile screen with name, goal, experience level, body metrics, and weight-entry form/list
- Per-screen `react-intl` messages (mobile does NOT use shared `next-intl` catalogs)
- New API clients for profile and weight entries
- PR #388 (955 non-test lines, accepted as `size:exception`)

### Out of Scope — Preserved

- Personal records remain weight-logged-only (no change to `isEligible` or Epley computation)
- No changes to `WorkoutExerciseSchema`, `WorkoutSessionSchema`, or `WorkoutProgramSchema`
- No mobile gendered-imagery suppression (no media-selection point located)
- No BMI, body-fat, circumference measurements, or health indices
- No formal health-data consent or retention policy beyond cascade-on-user-delete
- No weight-series charting (list is textual only)

## Key Decisions (from Proposal)

1. **SI units only** — kg/cm, no unit field, no per-user preference
2. **Body data is prompt input, never output schema** — avoided #357's trap
3. **Closed Langfuse channel by extending redaction** — general span-redaction capability, not body-metrics special case
4. **Volume shift is accepted AND announced** — at first weight entry only
5. **Weight resolution rule: nearest at-or-before, earliest as backstop** — settles history after first entry
6. **Personal records stay weight-logged-only** — confirmed unchanged
7. **Absent values degrade byte-for-byte** — testable, structural guarantee
8. **"Prefer not to say" is a positive value, not null** — distinguishes asked+declined from never-asked
9. **One self-described field, not two** — design decision 10 dropped gendered-imagery, removing gender's only consumer (data minimization)
10. **Gendered-imagery suppression is OUT OF SCOPE** — dropped by product owner

## Verification Results

**Verdict: PASS WITH WARNINGS**

### Gates (Freshly Run, 2026-08-08)
- Type-check (`pnpm type-check`): **PASS** — 7/7 workspaces clean
- Tests + coverage (`pnpm -r --if-present test:coverage`): **PASS**
  - apps/api: 181 files, 2154 tests passed + 135 skipped, functions **88.83%** (≥85)
  - apps/web: 158 files, 1716 tests passed, functions **94.31%** (≥90)
  - domain, contracts, i18n green
- Build (`pnpm build`): **PASS** — all 7 workspaces + Next (28 routes incl. `/profile`)
- Mobile tests (`cd apps/mobile && pnpm test`): **PASS** — 57 files, 499 tests

### Task Completion
- **74/74 core implementation tasks checked** (PR1–PR5)
- Two unchecked boxes in "Final Verification" are genuinely manual (live LLM call, GitHub access) — correctly deferred
- All sub-phase verification gates passed

### Requirement Compliance (by change)

**profile-body-metrics** (new): 13 requirements, all satisfied
- Body storage/CRUD: **E** (tested)
- Bodyweight entry recording/listing: **E** (tested; integration suite runs in CI)
- SI units only: **E** (structural + tested)
- Prompt degradation: **E** (byte-identity snapshot)
- Trace input protection: **E** (both halves: mask + model still receives)
- No schema addition: **C** (grep-confirmed)
- No observability leak: **E** (type-closed + lint)
- Volume resolution: **E** (pure domain, full behavior table)
- Volume-shift notice: **E** (component + mobile tests)
- Personal records unchanged: **E** (byte-identical regression pin)
- Mobile parity: **E** (round-trip + rejection tests)

**10a-v1-user-memory-structured** (MODIFIED, 2 requirements):
- Profile Storage: **E** (migration + schema tested)
- Profile CRUD: **E** (all scenarios incl. body-metric update)

**08-v1-ai-plan-generation** (ADDED, 1 requirement):
- Generation Prompt Carries Body Metrics: **E** for code path (rendering + redaction). **C** for live system: remote Langfuse template not yet updated with `{{bodyProfileSection}}` marker — see "Operational Gaps" below.

**09c-v1-progress-dashboard-stats** (MODIFIED, 1 requirement):
- Statistics Surface (bodyweight-inclusive volume): **E** (all KPI/trend/distribution/PR scenarios tested)

### Verified Controls

**Three privacy mechanisms, all wired and tested:**
1. **SDK `mask` hook**: `langfuse-handler.ts:69-79` → applied at enqueue, fails closed
2. **Span-redaction engine**: `trace-redaction.ts` + `TRACE_REDACTION_RULES` (one rule: `<body_profile>`)
3. **Fail-closed backstop**: `adapter-factory.ts:116-131` — re-renders without body data if redaction unverified

**Privacy holes closed:**
- `PlanTraceMetadata` type closes trace metadata call sites (compile error on excess keys)
- `observability-metadata-guard.test.ts` source scan flags body-metric keys in `metadata:` literals (lint, not guarantee)

**No regressions:**
- Personal records: `isEligible` unchanged (gates on `weightKg > 0` only)
- Output schemas: zero matches for body-metric fields in `WorkoutExerciseSchema`, `WorkoutSessionSchema`, `WorkoutProgramSchema`
- Volume surfaces: all four (KPI, trend, distribution, web tracker) use single resolved value
- CI pipeline: both integration suites (`user-weight-entry.integration.test.ts`, `workout-session.integration.test.ts`) added to hardcoded CI list

## Known Caveats

### 1. Operational Gap — Remote Prompt Template Not Updated

The Langfuse-hosted `kinora-plan-generation` prompt has **not** been updated with `{{bodyProfileSection}}`, so:
- **Today in production**: remote-resolved templates render without body data even for fully populated profiles
- **Code path**: correct and tested against local `PLAN_PROMPT_TEMPLATE`
- **Real-world effect**: inert until maintainer edits hosted prompt
- **Decision**: `bodyProfileSection` deliberately NOT in `requiredMarkers`/`orderedMarkers` (preserves byte-identical degradation, no forced fallback)

**Action Required**: Maintainer must update Langfuse prompt or add marker to `requiredMarkers` (explicit decision, not decided here).

### 2. Issue #374 Closed but Defect Unfixed

**Finding**: `kno/kInorA#374` is CLOSED (`stateReason: COMPLETED`, 2026-08-08 08:26 UTC), attributed to PR #386 (17c PR 3) via GitHub reference, **but the underlying defect is still present and verified unfixed**.

- **The Defect**: First-mention limitation text still reaches Langfuse trace (issue #374 tracks this)
- **PR #386's Statement**: "This PR does not fix #374, and a green build here must not be read as closing it."
- **Code Verification**: `TRACE_REDACTION_RULES` (trace-redaction.ts) contains exactly one rule (`<body_profile>`); no `<user_message>` rule was added
- **Status**: Manual close (no closing keyword in PR description or commits)

**Problem**: Nobody will know to revisit #374 because the tracker now says it's done.

**Action Required**: Reopen #374 with comment explaining the defect is still present, this is independent of 17c's code, and #374 composition (design.md §195-226) remains valid.

### 3. Spec Drift — Enum Values

**Finding**: Specification documents (`profile-body-metrics/spec.md` line 22, `10a-delta` line 8) state four values for `sexOrGender`: `male, female, other, prefer_not_to_say`. Implementation ships **five**: `female, male, non_binary, other, prefer_not_to_say`.

- **Not an Apply-phase Deviation**: Design.md has stated five values since its first draft ("The self-described field" §287-311)
- **No Behavioral Gap**: Route tests validate against `VALID_SELF_DESCRIBED_SEX` (which correctly includes `non_binary`); all spec-listed scenarios still work
- **Documentation Gap**: Spec should be corrected to list all five, or design rationale retrofitted into spec
- **Severity**: WARNING (not CRITICAL) — nothing user-facing or privacy-relevant is broken

**Action Required**: Update spec documents to list five values. Low priority; does not block behavior.

## Merged PRs Summary

| PR | Commit | Content | Non-test LOC | Verdict |
|---|---|---|---|---|
| #384 | f3b95f8 | selfDescribedSex + heightCm, migration 0027, seven layers | 291 | MERGED |
| #385 | 51bf92c | user_weight_entries, migration 0028, route/repo, web form, CI list | 680 | MERGED |
| #386 | 6d215ef | Trace redaction, prompt section, fail-closed backstop | 461 | MERGED |
| #387 | 9d793e4 | Bodyweight resolution, volume threading, first-entry notice | 334 | MERGED |
| #388 | fee2a44 | Mobile profile screen (greenfield), navigator, Home entry point | 955 | MERGED |
| | | **Total** | **2721** | **COMPLETE** |

## Implementation Highlights

- **Strict TDD**: Every implementation task preceded by RED test (tests ship same commit as module)
- **Coverage gates pass**: apps/api 88.83% (≥85), apps/web 94.31% (≥90)
- **Pure domain logic**: Weight resolution rule unit-testable, runs in CI (mitigation for #382)
- **One resolved value**: Eliminates volume drift between three computation sites; all four surfaces consistent
- **Privacy-first design**: Three independent guards; redaction at SDK boundary (enqueue, pre-network)
- **Byte-identical degradation**: Absent body data renders unchanged prompt (structural guarantee)
- **Mobile parity**: Same validation/isolation rules as web; per-screen i18n convention followed

## Follow-up Work

- **#374 reopening**: First-mention limitation text redaction (compose with 17c's general span rule)
- **Remote prompt update**: Add `{{bodyProfileSection}}` to Langfuse-hosted template or decide on `requiredMarkers`
- **Spec drift correction**: List five enum values in profile-body-metrics/spec.md and 10a delta spec
- **Health-data classification**: Formal consent/retention policy (product + legal)
- **Mobile gendered imagery**: No insertion point located; file once found
- **Weight-series charting**: Textual list today; dated trend chart could be follow-up

## Artifacts Included in Archive

- `exploration.md` — read-only investigation, issue claims verified, weight resolution rule gap identified
- `proposal.md` — scope, pinned decisions (1–10), resolved question round, rollback plan, success criteria
- `design.md` — technical approach (5 seams), corrections to proposal, architecture decisions, testing strategy
- `tasks.md` — 74 core tasks (PR1–PR5), repo gotchas, review workload forecast, open apply-time decisions
- `verify-report.md` — PASS WITH WARNINGS verdict, all gates green, requirement compliance, known issues
- `specs/profile-body-metrics/spec.md` — full new capability spec (13 requirements, 33 scenarios)
- `specs/10a-v1-user-memory-structured/spec.md` — delta (2 modified requirements + scenarios)
- `specs/08-v1-ai-plan-generation/spec.md` — delta (1 added requirement + scenarios)
- `specs/09c-v1-progress-dashboard-stats/spec.md` — delta (1 modified requirement + scenarios)

## State at Close

- **Main branch**: All five PRs merged; latest commit `fee2a44`
- **Database**: Two migrations applied (`0027` — profile scalars, `0028` — weight series)
- **Specs**: Main specs updated with all deltas; delta specs retained in archive for reference
- **Tests**: All gates green; coverage thresholds met; 74 core tasks complete
- **Deployments**: Five PRs deployed to production

## Closure Notes

This change successfully extended user physiological data capture and consumption across the platform with robust privacy controls. The retroactive volume shift was accepted and announced at first weight entry. Body metrics reach generation without leaking to third parties or output schemas. Personal records remain unaffected. Mobile received parity implementation. The two caveats (remote prompt not yet updated, #374 closed prematurely) are maintenance actions outside the code's remit.

---

**Archived by**: SDD archive phase  
**Date**: 2026-08-08  
**For reference**: [kno/kInorA#361](https://github.com/kno/kInorA/issues/361), PRs #384–#388
