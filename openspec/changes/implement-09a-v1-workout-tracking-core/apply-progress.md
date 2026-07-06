# Apply Progress: implement-09a-v1-workout-tracking-core

**Batch**: PR3 — web tracker surface
**Branch**: feat/09a-tracking-web
**Mode**: Strict TDD
**Date**: 2026-07-06

---

## Completed Tasks

- [x] 1.1 RED: added `packages/domain/src/__tests__/rpe.test.ts` and extended `packages/contracts/src/__tests__/exports-conditions.test.ts` with tracking DTO export guards.
- [x] 1.2 GREEN: created `packages/domain/src/plan/rpe.ts` and exported `validateRpe` / `RpeValidation` from `packages/domain/src/plan/index.ts` and `packages/domain/src/index.ts`.
- [x] 1.3 GREEN: added `WorkoutSessionRecord`, `SessionExerciseRecord`, `SetRecordDTO`, and `WorkoutSessionRecordStatus` to `packages/contracts/src/index.ts`.
- [x] 1.4 RED/GREEN: added `apps/api/src/db/__tests__/workout-tracking-schema.test.ts`, created `workout_sessions`, `session_exercises`, `set_records` in `apps/api/src/db/schema.ts`, and added `apps/api/drizzle/0005_workout_tracking.sql` with the partial unique active-session guard.
- [x] 2.1 RED/GREEN: added `apps/api/src/db/repositories/__tests__/workout-session.test.ts` and `apps/api/src/db/repositories/workout-session.ts` for tenant/user-scoped session reads with exercises and set records.
- [x] 2.2 RED/GREEN: extended the workout-session repository to start immutable ready-plan snapshots and reuse the existing active session.
- [x] 2.3 RED/GREEN: extended the workout-session repository to record set progress and complete active sessions.
- [x] 2.4 RED/GREEN: added protected workout-session route tests for authentication, not-found behavior, invalid bodies/RPE, active-session start reuse, set recording, and completion.
- [x] 2.5 GREEN: added `apps/api/src/routes/workout-session.ts` and registered it in `apps/api/src/app.ts`.
- [x] 3.1 RED: added tracker web tests for start/resume actions in `apps/web/src/app/(app)/plan/[id]/__tests__/actions.test.ts` and live tracker rendering/interaction in `apps/web/src/app/(app)/plan/[id]/__tests__/tracker.test.tsx`.
- [x] 3.2 GREEN: added workout tracker server helpers and server actions for start, fetch, record-set, and complete flows via the httpOnly session cookie.
- [x] 3.3 GREEN: added a live tracker surface, set logging controls, completion CTA, and start-workout CTA wiring from the ready-plan view.
- [x] 3.4 GREEN: added tracker copy to both i18n catalogs and kept catalog parity green.

---

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/domain/src/__tests__/rpe.test.ts`, `packages/contracts/src/__tests__/exports-conditions.test.ts` | Unit | ✅ domain-adjacent 61/61, contracts 5/5 | ✅ Written (`rpe.js` missing; DTO exports absent) | ✅ domain 4/4, contracts 7/7 | ✅ bounds + non-numeric rejection + non-colliding DTO checks | ➖ None needed |
| 1.2 | `packages/domain/src/__tests__/rpe.test.ts` | Unit | ✅ domain-adjacent 61/61 | ✅ Written in 1.1 | ✅ 4/4 | ✅ accepts 0/5/10, rejects range + non-finite values | ✅ extracted `MIN_RPE` / `MAX_RPE` constants |
| 1.3 | `packages/contracts/src/__tests__/exports-conditions.test.ts` | Unit | ✅ contracts 5/5 | ✅ Written in 1.1 | ✅ 7/7 | ✅ session record + exercise record + set DTO shape checks | ➖ None needed |
| 1.4 | `apps/api/src/db/__tests__/workout-tracking-schema.test.ts` | Unit | ✅ schema baseline 41/41 | ✅ Written (migration file missing) | ✅ 10/10 | ✅ enum values + 3 table shapes + partial unique index migration guard | ➖ None needed |
| 2.1 | `apps/api/src/db/repositories/__tests__/workout-session.test.ts` | Integration | N/A (new) | ✅ Written (`workout-session.js` missing) | ✅ 3/3 | ✅ session read + tenant no-data + user no-data | ✅ kept DTO mapping local to repository |
| 2.2 | `apps/api/src/db/repositories/__tests__/workout-session.test.ts` | Integration | ✅ 2.1 read-model tests 3/3 | ✅ Added start/reuse tests before implementation | ✅ 5/5 | ✅ immutable snapshot + existing active reuse | ✅ reused read-model mapper for start output |
| 2.3 | `apps/api/src/db/repositories/__tests__/workout-session.test.ts` | Integration | ✅ 2.1/2.2 repository tests 5/5 | ✅ Added record-set and complete-session tests before implementation | ✅ 8/8 repository tests, 61/61 targeted API tests | ✅ set ownership guard + active-session completion | ✅ kept route concerns out of repository slice |
| 2.4 | `apps/api/src/routes/__tests__/workout-session.test.ts` | Integration | ✅ existing auth/plan route tests | ✅ Added route tests before route registration | ✅ 7/7 route tests, 68/68 targeted API tests | ✅ 401, 404, 422 body, 422 RPE, active-session reuse, set recording, completion | ✅ injected repository mock to isolate route behavior |
| 2.5 | `apps/api/src/routes/__tests__/workout-session.test.ts` | Integration | ✅ route tests from 2.4 | ✅ Route tests failed while route module/app registration were absent | ✅ 7/7 route tests, 68/68 targeted API tests | ✅ start/read/record/complete route wiring | ✅ route depends on an injected repo port; app composition wires the concrete repository |
| 3.1 | `apps/web/src/app/(app)/plan/[id]/__tests__/actions.test.ts`, `apps/web/src/app/(app)/plan/[id]/__tests__/tracker.test.tsx` | Integration | ✅ existing plan-status web tests 22/22 | ✅ Added tracker action + live-render tests before the new actions/UI existed | ✅ 11/11 targeted tracker tests, 29/29 targeted plan-page tests | ✅ start/resume flow + set logging + integer-only RPE input + completion + analytics/offline absence | ✅ kept assertions behavioral instead of CSS/detail-coupled |
| 3.2 | `apps/web/src/app/(app)/plan/[id]/__tests__/actions.test.ts` | Integration | ✅ existing action tests 4/4 | ✅ Added failing wrapper tests for missing start/fetch/record/complete actions | ✅ 8/8 action tests, 28/28 targeted plan-page tests | ✅ httpOnly cookie forwarding for all four tracker actions | ✅ extracted shared server-only tracker helpers + shared action unwrap |
| 3.3 | `apps/web/src/app/(app)/plan/[id]/__tests__/tracker.test.tsx` | Integration | ✅ existing plan-status web tests 22/22 | ✅ Added failing live-tracker tests before tracker UI existed | ✅ 3/3 tracker tests, 29/29 targeted plan-page tests | ✅ ready-plan CTA, live tracker rendering, integer-only RPE input, set forms, completion state, deferred analytics/offline controls omitted | ✅ isolated tracker rendering into `TrackerPanel` |
| 3.4 | `apps/web/src/i18n/__tests__/catalog-parity.test.ts` | Unit | ✅ catalog parity baseline 3/3 | ✅ Added catalog-dependent tracker copy before updating messages | ✅ 3/3 parity tests | ✅ new keys added in English and Spanish with matching placeholders | ➖ None needed |

### Test Summary

- **Total tests written**: 44 (37 prior + 7 Phase 3 web tests)
- **Total tests passing**: 32 targeted web/i18n tests in this batch; prior Phase 1-2 API verification remains green in earlier batches
- **Layers used**: Unit (3), Integration (28)
- **Approval tests**: None — no behavioral refactor of legacy logic
- **Pure functions created**: 1 (`validateRpe`)

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `packages/domain/src/__tests__/rpe.test.ts` | Created | Strict-TDD unit tests for valid/invalid RPE handling |
| `packages/domain/src/plan/rpe.ts` | Created | Pure `validateRpe` domain validator |
| `packages/domain/src/plan/index.ts` | Modified | Exported `validateRpe` and `RpeValidation` |
| `packages/domain/src/index.ts` | Modified | Re-exported tracking RPE validator from package root |
| `packages/contracts/src/index.ts` | Modified | Added workout tracking DTOs with non-colliding names |
| `packages/contracts/src/__tests__/exports-conditions.test.ts` | Modified | Added source-export guards and type-shape checks for tracking DTOs |
| `apps/api/src/db/__tests__/workout-tracking-schema.test.ts` | Created | Schema and migration tests for workout tracking foundation |
| `apps/api/src/db/repositories/__tests__/workout-session.test.ts` | Modified | Repository coverage from earlier PR2 repository slices |
| `apps/api/src/db/repositories/workout-session.ts` | Modified | Repository implementation from earlier PR2 repository slices |
| `apps/api/src/routes/__tests__/workout-session.test.ts` | Created | Protected workout-session route tests for auth/error paths and endpoint wiring |
| `apps/api/src/routes/workout-session.ts` | Created | Protected workout-session routes for start/read/set update/complete using an injected repository port and typed Fastify route bodies/params |
| `apps/api/src/app.ts` | Modified | Registers workout-session routes with repository dependency |
| `apps/api/src/db/schema.ts` | Modified | Added workout tracking enum/tables/indexes |
| `apps/api/drizzle/0005_workout_tracking.sql` | Created | Additive SQL migration with single-active-session unique guard |
| `apps/web/src/app/(app)/plan/[id]/tracker-types.ts` | Created | Shared web-only tracker input contract for set logging |
| `apps/web/src/app/(app)/plan/[id]/tracker-client.ts` | Created | Server-only tracker API helpers for start/fetch/record/complete flows |
| `apps/web/src/app/(app)/plan/[id]/TrackerPanel.tsx` | Created | Live workout tracker UI with set logging forms and completion CTA |
| `apps/web/src/app/(app)/plan/[id]/PlanStatusClient.tsx` | Modified | Switches from ready-plan view to live tracker after start/resume and wires tracker actions |
| `apps/web/src/app/(app)/plan/[id]/PlanStatusView.tsx` | Modified | Adds start-workout CTA to the ready-plan surface |
| `apps/web/src/app/(app)/plan/[id]/actions.ts` | Modified | Adds start/fetch/record/complete workout server actions using the session cookie |
| `apps/web/src/app/(app)/plan/[id]/__tests__/actions.test.ts` | Modified | Adds strict-TDD action coverage for workout tracker wrappers |
| `apps/web/src/app/(app)/plan/[id]/__tests__/tracker.test.tsx` | Created | Covers start/resume flow, tracker rendering, set logging, and completion |
| `apps/web/src/i18n/messages/en.json` | Modified | Adds English tracker copy |
| `apps/web/src/i18n/messages/es.json` | Modified | Adds Spanish tracker copy with catalog parity |
| `openspec/changes/implement-09a-v1-workout-tracking-core/tasks.md` | Modified | Marked Phase 3 web tracker tasks 3.1-3.4 complete |
| `openspec/changes/implement-09a-v1-workout-tracking-core/apply-progress.md` | Modified | Updated cumulative strict-TDD progress for the Phase 3 web tracker slice |

---

## Verification Results

```text
pnpm --filter web test "src/app/(app)/plan/[id]/__tests__/actions.test.ts" "src/app/(app)/plan/[id]/__tests__/PlanStatusClient.test.tsx" "src/app/(app)/plan/[id]/__tests__/plan-status.test.tsx" "src/app/(app)/plan/[id]/__tests__/tracker.test.tsx"
  4 files passed, 29 tests passed.
```

```text
pnpm --filter web test "src/i18n/__tests__/catalog-parity.test.ts"
  1 file passed, 3 tests passed.
```

```text
pnpm --filter web test "src/app/(app)/plan/[id]/__tests__/actions.test.ts" "src/app/(app)/plan/[id]/__tests__/tracker.test.tsx"
  RED phase before implementation: 2 files failed with missing tracker actions / missing start CTA.
```

---

## Deviations from Design

- **Helper file naming** — `design.md` specified helper files named `plan-draft-client.ts` and `boundary.ts`. The implementation used `tracker-client.ts` (server-only API helpers) and route-local Fastify JSON schemas instead of a separate `boundary.ts`. Functionally equivalent and structurally cleaner; no behavioral impact.

Phase 3 web tracker boundary is otherwise matched exactly. Analytics/offline controls and issue #85 route-layer guardrails remain intentionally out of scope.

---

## Workload / PR Boundary

- Mode: stacked PR slice
- Current work unit: PR3 web tracker/actions
- Boundary: includes only `apps/web` tracker actions, ready-plan CTA wiring, tracker UI, and i18n copy; excludes Phase 4 verification sweep and issue #85 route-layer guardrails
- Estimated review budget impact: focused on one web surface plus four server-action wrappers

---

## Phase 4 — Verification / Cleanup

### 4.1 Coverage extension (RED/GREEN)

Honesty note: the three concerns were already substantially covered by Phase 1-3.
This task added the genuinely-missing slices and locked in existing behavior;
duplicate coverage was intentionally NOT re-added.

- **(a) Snapshot immutability** — PARTIAL GAP filled. The existing start test mutated the
  plan program *after* `startSession` returned. Added
  `snapshots exercise context so later plan edits do not leak into the started session`
  (repository test) asserting the returned session exposes the persisted snapshot
  values (`Bench Press`, `restSeconds: 90`) and is unaffected by later plan-JSON
  mutation. This proves the repo maps from persisted relational rows, not from
  the mutable source `programJson`.
- **(b) Valid AND invalid RPE** — ALREADY COVERED at domain + route (invalid rpe=11 → 422,
  valid rpe=8 → 200), plus domain unit bounds. Added one route test
  `accepts inclusive RPE boundary values and records the set` for rpe=0 and rpe=10
  to close the inclusive-boundary gap at the API boundary. Did not duplicate the
  domain-level bounds tests.
- **(c) Same-tenant cross-user no-data** — read path ALREADY COVERED
  (`findById` user-mismatch → undefined; route GET → 404). Added the missing
  *write*-path isolation: repository tests
  `does not write a set for a session owned by another user in the same tenant`
  and `does not complete a session owned by another user in the same tenant`
  (both return undefined, no `update` call), plus route test
  `returns 404 when recording a set for another user's session in the same tenant`.

New tests added: 5 (3 repository, 2 route). Targeted API run:
`pnpm --filter api test src/db/repositories/__tests__/workout-session.test.ts src/routes/__tests__/workout-session.test.ts`
→ 2 files passed, 20 tests passed (was 15; +5). All new tests pass GREEN;
because the underlying behavior already existed from Phase 1-3, these function as
characterization/coverage tests rather than new-behavior RED cycles — documented
honestly here per strict-TDD reporting.

- **(d) Start requires a ready plan → no session is created** — SPEC SCENARIO GAP filled (Warning 1).
  Added repository tests `returns undefined and performs no insert when the plan is not in a ready state`
  and `returns undefined and performs no insert when the requested day does not exist in the plan`,
  plus route test `returns 404 when start is called for a plan that is not ready`.
  All three are characterization tests — the behavior was already correct and implemented.
  Targeted run after additions: `2 files passed, 23 tests passed` (was 20; +3).

### 4.2 Verification sweep (actual output)

| Command | Result |
|---------|--------|
| `pnpm type-check` | PASS — all 5 workspace projects (`contracts`, `mobile`, `domain`, `web`, `api`) `tsc --noEmit` Done, 0 errors |
| `pnpm test` | PASS — mobile 34, contracts 32, domain 91, api 529, web 521 = 1207 tests, all green |
| `pnpm architecture` | PASS — no dependency violations (1518 modules, 4326 deps); negative guard passed |
| `pnpm deps-guard` | PASS — no prohibited dependencies in any package.json |
| `pnpm build` | PASS — domain/api tsc Done; web Next.js 16.2.9 compiled successfully, 17/17 static pages generated |

No regressions found. No pre-existing failures encountered — the entire suite was
green, so nothing was left untouched or triaged out.
