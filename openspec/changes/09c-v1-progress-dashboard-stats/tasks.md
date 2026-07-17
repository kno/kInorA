# Tasks: Progress Dashboard, Statistics & Weekly Overview (09c)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,900–2,400 total across 7 slices |
| 400-line budget risk | High (Foundation, Statistics), Medium-High (Dashboard, 4b), Medium (4a) |
| Chained PRs recommended | Yes |
| Suggested split | 1a → 1b → Dashboard → 3a → 3b → 4a → 4b (7 chained PRs) |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

Delivery decision (ask-on-risk gate resolved with the user): the two High-risk slices are split so no PR exceeds ~400 lines → **7 chained PRs**, feature-branch-chain (each PR bases on the previous; only the tracker merges to main).

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1a | Contracts (`MuscleGroup`/`MUSCLE_GROUPS`/`MuscleRegion`, DTOs, create `PersonalRecord`) + bilingual EN/ES classifier `classifyExerciseMuscleGroup` + `@kinora/domain/progress` subpath scaffold (+ package.json `./progress` export) | PR 1a | base = feature/tracker branch; ~300-380 lines; pure + type-level, no schema |
| 1b | Schema: additive nullable `muscle_group` column + migration + write-time populate in `insertSessionExercises` + idempotent batched backfill w/ versioned reclassify path + schema-comment carve-out | PR 1b | base = PR 1a; depends on 1a's classifier + `MuscleGroup`; ~250-350 lines |
| 2 | Dashboard: `getDashboardSummary` + `computeStreak`/`computeAdherence`/`computeWeeklyRollup` + route + page (built to `web-dashboard.html`) | PR 2 | base = PR 1b; ~350-450 lines |
| 3a | Statistics part 1: `getStatsRange` + KPIs with delta-vs-previous (null on zero baseline) + volume trend + page shell | PR 3a | base = PR 2; ~300-380 lines |
| 3b | Statistics part 2: `computeMuscleGroupDistribution` (10→coarse, horizontal bar) + `computePersonalRecords` (Epley 1RM, eligible sets only) + wire into stats page | PR 3b | base = PR 3a; needs 1b's `muscle_group` column; ~300-380 lines |
| 4a | Weekly board visual realignment (closes #128) | PR 4a | base = PR 3b; visual-only, no new data behavior; ~250-350 lines |
| 4b | Weekly-progress data + exercise detail (`getWeeklyOverview` + `computeWeeklyPlanVsCompletion` + `getExerciseDetail`) | PR 4b | base = PR 4a; depends on 4a merged first; ~350-450 lines |

## Slice 1a: Contracts + Classifier + `progress` subpath (PR 1a)

- [x] 1a.1 RED: write unit tests for `classifyExerciseMuscleGroup` in `packages/domain/src/progress/classify.test.ts` covering EN + ES keyword sets, normalized-title matching (diacritics/whitespace/case), and null-degrade for unmapped titles
- [x] 1a.2 GREEN: implement `classifyExerciseMuscleGroup` + shared title-normalization helper in `packages/domain/src/progress/classify.ts`
- [x] 1a.3 Add `MuscleGroup`, `MUSCLE_GROUPS`, `MuscleRegion` to `packages/contracts/src/index.ts`; add `PersonalRecord`, `DashboardSummaryDTO`, `StatsSummaryDTO`, `WeeklyOverviewDTO`, `ExerciseDetailDTO`
- [x] 1a.4 Create `packages/domain/src/progress/index.ts` barrel; add `./progress` subpath export in `packages/domain/package.json` (never via root barrel)
- [x] 1a.5 RED: write a deps-guard/import test asserting no `@kinora/domain/progress` consumer imports the root `@kinora/domain` barrel
- [x] 1a.6 Verify: `pnpm test`, `pnpm type-check`, `pnpm architecture`, `pnpm deps-guard`, `pnpm build` all pass

## Slice 1b: Schema column + backfill (PR 1b, base = 1a)

- [ ] 1b.1 Add nullable additive `muscle_group varchar` column + drizzle migration to `apps/api/src/db/schema.ts`; update the `session_exercises` doc comment to "immutable except the derived `muscle_group` classification column"
- [ ] 1b.2 RED: write integration test asserting `insertSessionExercises` populates `muscle_group` at write time via the classifier
- [ ] 1b.3 GREEN: wire `classifyExerciseMuscleGroup` (from 1a) into `insertSessionExercises` in `apps/api/src/db/repositories/workout-session.ts`
- [ ] 1b.4 RED: write tests for the backfill script — idempotency, batching/chunking by `id`, resume-after-interruption, and versioned reclassify path
- [ ] 1b.5 GREEN: implement the idempotent, batched backfill script in `apps/api/src/db/` (`WHERE muscle_group IS NULL` fill + explicit reclassify mode)
- [ ] 1b.6 Verify: `pnpm test`, `pnpm type-check`, `pnpm architecture`, `pnpm deps-guard`, `pnpm build` all pass

## Slice 2: Dashboard (PR 2, base = 1b)

- [ ] 2.1 RED: write unit tests for `computeStreak` (consecutive UTC calendar days, gap-day reset, ends today or yesterday)
- [ ] 2.2 GREEN: implement `computeStreak` in `packages/domain/src/progress/streak.ts`
- [ ] 2.3 RED: write unit tests for `computeAdherence` (completed vs. planned sessions for current UTC calendar week, no inflated counts mid-week)
- [ ] 2.4 GREEN: implement `computeAdherence` in `packages/domain/src/progress/adherence.ts`
- [ ] 2.5 RED: write unit tests for `computeWeeklyRollup` (per-day load/volume bars for "Ruta de carga")
- [ ] 2.6 GREEN: implement `computeWeeklyRollup` in `packages/domain/src/progress/weekly-rollup.ts`
- [ ] 2.7 RED: write integration test for `getDashboardSummary({tenantId, userId})` asserting bounded query, (tenantId,userId) scoping, and empty-state (no history) behavior
- [ ] 2.8 GREEN: implement `getDashboardSummary` on the progress repository in `apps/api/src/db/repositories/workout-session.ts`
- [ ] 2.9 Create thin `GET /progress/dashboard` route in `apps/api/src/routes/progress.ts`
- [ ] 2.10 Pull `screens/web-dashboard.html` via OpenDesign MCP; build `apps/web/.../dashboard/page.tsx` (streak sparkline, weekly progress X/Y, week-route strip) — exclude Coach AI card and readiness ring (out of scope)
- [ ] 2.11 Add EN/ES dashboard copy to `packages/i18n/src/messages/{en,es}.json`
- [ ] 2.12 RED/GREEN: component tests for dashboard page — data render, empty state, EN/ES parity
- [ ] 2.13 Verify: `pnpm test`, `pnpm type-check`, `pnpm architecture`, `pnpm deps-guard`, `pnpm build` all pass

## Slice 3a: Statistics — KPIs + deltas + volume trend (PR 3a, base = 2)

- [ ] 3a.1 RED: write unit tests for the KPI delta function (null when previous-period value is 0/absent; never Infinity/NaN)
- [ ] 3a.2 GREEN: implement the shared delta helper in `packages/domain/src/progress/delta.ts`
- [ ] 3a.3 RED: write integration test for `getStatsRange({tenantId, userId, range})` asserting bounded query, (tenantId,userId) scoping, and sparse/absent-data degrade (KPIs + volume trend)
- [ ] 3a.4 GREEN: implement `getStatsRange` on the progress repository — KPIs (volume/sessions/time/PR-count) with period deltas + volume-trend series (current vs. previous)
- [ ] 3a.5 Create thin `GET /progress/stats` route in `apps/api/src/routes/progress.ts`
- [ ] 3a.6 Pull `screens/web-stats.html` via OpenDesign MCP; build the `apps/web/.../stats/page.tsx` shell with the period toggle, KPI cards w/ deltas, and the volume-trend chart — no adherence KPI; leave distribution + PR sections for 3b
- [ ] 3a.7 Add EN/ES stats KPI copy to i18n messages
- [ ] 3a.8 RED/GREEN: component tests for the stats KPIs — delta null-state render, EN/ES parity
- [ ] 3a.9 Verify: `pnpm test`, `pnpm type-check`, `pnpm architecture`, `pnpm deps-guard`, `pnpm build` all pass

## Slice 3b: Statistics — muscle-group distribution + PRs (PR 3b, base = 3a; needs 1b's `muscle_group` column)

- [ ] 3b.1 RED: write unit tests for `computeMuscleGroupDistribution` (10 primary groups, unmapped exercises excluded gracefully, set-count + volume per group)
- [ ] 3b.2 GREEN: implement `computeMuscleGroupDistribution` in `packages/domain/src/progress/distribution.ts`
- [ ] 3b.3 RED: write unit tests for `computePersonalRecords` (Epley estimated 1RM; eligible-set guard completed+weightKg>0+actualReps>0; bodyweight/no-weight/null-reps excluded and omitted not zeroed; grouped by normalized title; trend + signed delta)
- [ ] 3b.4 GREEN: implement `computePersonalRecords` in `packages/domain/src/progress/personal-records.ts`
- [ ] 3b.5 GREEN: extend `getStatsRange` to include `muscleGroupDistribution` + `personalRecords` in `StatsSummaryDTO` (still one bounded query)
- [ ] 3b.6 Wire the horizontal-bar muscle distribution (10→coarse UI mapping) and the PR table into `stats/page.tsx`; add `progress.muscle.<slug>` labels to i18n — exclude the workout-type donut (out of scope)
- [ ] 3b.7 RED/GREEN: component tests — distribution with an unmapped exercise, PR table, EN/ES parity
- [ ] 3b.8 Verify: `pnpm test`, `pnpm type-check`, `pnpm architecture`, `pnpm deps-guard`, `pnpm build` all pass

## Slice 4a: Weekly Board Visual Realignment (PR 4a, base = 3b; closes #128)

- [ ] 4a.1 Pull `screens/web-plan.html` via OpenDesign MCP; diff against current `PlanWeekView.tsx` / `DayDetailPanel.tsx`
- [ ] 4a.2 RED: write/update component snapshot or structural tests asserting the realigned layout, tokens, and component structure — no new data props
- [ ] 4a.3 GREEN: realign `apps/web/.../plan/PlanWeekView.tsx` and `DayDetailPanel.tsx` to `web-plan.html` (layout, spacing, tokens only — no day-status/nav wiring changes)
- [ ] 4a.4 REFACTOR: extract shared card/list primitives reused by dashboard/stats if applicable
- [ ] 4a.5 Verify: `pnpm test`, `pnpm type-check`, `pnpm build` pass; confirm issue #128 acceptance criteria met

## Slice 4b: Weekly-Progress Data + Exercise Detail (PR 4b, base = 4a)

- [ ] 4b.1 RED: write unit tests for `computeWeeklyPlanVsCompletion` — exhaustive precedence (done→active(today)→soon(future planned)→rest incl. past skipped), UTC week boundaries, predating-week all-rest case, done counts regardless of plan version
- [ ] 4b.2 GREEN: implement `computeWeeklyPlanVsCompletion` in `packages/domain/src/progress/weekly-plan-vs-completion.ts`
- [ ] 4b.3 RED: write integration tests for `getWeeklyOverview({tenantId, userId, weekStart})` — bounded query, (tenantId,userId) scoping, plan-version-agnostic done, out-of-range week behavior
- [ ] 4b.4 GREEN: implement `getWeeklyOverview` on the progress repository
- [ ] 4b.5 RED: write integration test for `getExerciseDetail({tenantId, userId, title})` including an explicit IDOR test (user A cannot read user B's rows via a crafted `title`)
- [ ] 4b.6 GREEN: implement `getExerciseDetail` on the progress repository, scoping `title` strictly as an additional filter inside the (tenantId,userId) scope
- [ ] 4b.7 Create thin `GET /progress/weekly-overview` and `GET /progress/exercise-detail` routes in `apps/api/src/routes/progress.ts`
- [ ] 4b.8 Wire day-state (done/active/rest/soon) and prev/next week navigation into `PlanWeekView.tsx` on top of 4a's realigned layout
- [ ] 4b.9 Pull `screens/mobile-exercise.html` (reference) via OpenDesign MCP; build the read-only exercise-history section in `apps/web/.../exercises/page.tsx`, omitting the section when no history exists
- [ ] 4b.10 Add EN/ES copy for weekly board states and exercise-detail section
- [ ] 4b.11 RED/GREEN: component tests — week navigation, all four day states, predating-week empty state, exercise detail with/without history, EN/ES parity
- [ ] 4b.12 Verify: `pnpm test`, `pnpm type-check`, `pnpm architecture`, `pnpm deps-guard`, `pnpm build` all pass; confirm no `PlanWeekView`/`DayDetailPanel` diff conflicts with 4a
