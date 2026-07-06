# Apply Progress: implement-09a-v1-workout-tracking-core

**Batch**: PR2d — API workout session routes
**Branch**: feat/09a-tracking-routes
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

### Test Summary

- **Total tests written**: 37 (22 foundation + 8 repository + 7 route checks)
- **Total tests passing**: 68 targeted API tests plus full workspace test suite in the latest PR2d run
- **Layers used**: Unit (22), Integration (13)
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
| `openspec/changes/implement-09a-v1-workout-tracking-core/tasks.md` | Modified | Marked API route tasks 2.4 and 2.5 complete |
| `openspec/changes/implement-09a-v1-workout-tracking-core/apply-progress.md` | Modified | Updated cumulative strict-TDD progress for PR2d route slice |

---

## Verification Results

```text
pnpm --filter api test "src/routes/__tests__/workout-session.test.ts"
  1 file passed, 7 tests passed.
```

```text
pnpm --filter api test "src/routes/__tests__/workout-session.test.ts" "src/db/repositories/__tests__/workout-session.test.ts" "src/routes/__tests__/plan.test.ts" "src/routes/__tests__/plan-generation.test.ts"
  4 files passed, 68 tests passed.
```

```text
pnpm type-check
  Passed for packages/contracts, packages/domain, apps/api, apps/web, and apps/mobile.
```

```text
pnpm architecture
  Passed dependency-cruiser and negative architecture guards.
```

```text
pnpm --filter api test "src/routes/__tests__/workout-session.test.ts" && pnpm type-check && pnpm architecture
  Passed after decoupling the route plugin from the concrete DB repository adapter.
```

```text
pnpm --filter api test "src/routes/__tests__/workout-session.test.ts" && pnpm type-check
  Passed after replacing manual request.body/request.params casts with Fastify route generics.
```

```text
pnpm deps-guard
  Passed for all package.json files.
```

```text
pnpm test
  Passed for packages/contracts, packages/domain, apps/api, apps/web, and apps/mobile.
```

```text
pnpm build
  Passed deps guard, UI/API guard, architecture guard, package builds, API build, and web production build.
```

---

## Deviations from Design

None — implementation matches the split Phase 2d boundary. This PR adds HTTP route wiring over the already-merged repository behavior; web tracker/actions stay in later PRs.

---

## Workload / PR Boundary

- Mode: stacked PR slice
- Current work unit: PR2d API workout-session routes
- Boundary: includes only `apps/api` workout-session route tests, route implementation, and app registration; excludes web tracker/actions and Phase 4 guardrail sweeps
- Estimated review budget impact: focused on HTTP boundary behavior only

---

## Remaining Tasks

- [ ] 3.1 RED: add web tests for start/resume actions and live tracker rendering in `apps/web/src/app/(app)/plan/[id]/__tests__/tracker.test.tsx` (or the nearest existing plan tests).
- [ ] 3.2 GREEN: add server actions in `apps/web/src/app/(app)/plan/[id]/actions.ts` (or a new tracker actions file) to start, fetch, record sets, and complete via the httpOnly session cookie.
- [ ] 3.3 GREEN: build the tracker/exercise UI under `apps/web/src/app/(app)/plan/[id]/` and wire the start CTA from the ready-plan view; omit analytics/offline controls.
- [ ] 3.4 GREEN: add required copy to `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/es.json`, then keep catalog parity green.
- [ ] 4.1 RED/GREEN: extend API/web tests for snapshot immutability, valid/invalid RPE, and same-tenant cross-user no-data behavior.
- [ ] 4.2 Run `pnpm type-check`, `pnpm test`, `pnpm architecture`, `pnpm deps-guard`, and `pnpm build`; fix only 09a regressions.
