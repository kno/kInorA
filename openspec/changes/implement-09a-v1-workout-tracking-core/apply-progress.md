# Apply Progress: implement-09a-v1-workout-tracking-core

**Batch**: PR1 — contracts/domain + schema/migration
**Branch**: feat/09a-tracking-foundation
**Mode**: Strict TDD
**Date**: 2026-07-04

---

## Completed Tasks

- [x] 1.1 RED: added `packages/domain/src/__tests__/rpe.test.ts` and extended `packages/contracts/src/__tests__/exports-conditions.test.ts` with tracking DTO export guards.
- [x] 1.2 GREEN: created `packages/domain/src/plan/rpe.ts` and exported `validateRpe` / `RpeValidation` from `packages/domain/src/plan/index.ts` and `packages/domain/src/index.ts`.
- [x] 1.3 GREEN: added `WorkoutSessionRecord`, `SessionExerciseRecord`, `SetRecordDTO`, and `WorkoutSessionRecordStatus` to `packages/contracts/src/index.ts`.
- [x] 1.4 RED/GREEN: added `apps/api/src/db/__tests__/workout-tracking-schema.test.ts`, created `workout_sessions`, `session_exercises`, `set_records` in `apps/api/src/db/schema.ts`, and added `apps/api/drizzle/0005_workout_tracking.sql` with the partial unique active-session guard.

---

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/domain/src/__tests__/rpe.test.ts`, `packages/contracts/src/__tests__/exports-conditions.test.ts` | Unit | ✅ domain-adjacent 61/61, contracts 5/5 | ✅ Written (`rpe.js` missing; DTO exports absent) | ✅ domain 4/4, contracts 7/7 | ✅ bounds + non-numeric rejection + non-colliding DTO checks | ➖ None needed |
| 1.2 | `packages/domain/src/__tests__/rpe.test.ts` | Unit | ✅ domain-adjacent 61/61 | ✅ Written in 1.1 | ✅ 4/4 | ✅ accepts 0/5/10, rejects range + non-finite values | ✅ extracted `MIN_RPE` / `MAX_RPE` constants |
| 1.3 | `packages/contracts/src/__tests__/exports-conditions.test.ts` | Unit | ✅ contracts 5/5 | ✅ Written in 1.1 | ✅ 7/7 | ✅ session record + exercise record + set DTO shape checks | ➖ None needed |
| 1.4 | `apps/api/src/db/__tests__/workout-tracking-schema.test.ts` | Unit | ✅ schema baseline 41/41 | ✅ Written (migration file missing) | ✅ 10/10 | ✅ enum values + 3 table shapes + partial unique index migration guard | ➖ None needed |

### Test Summary

- **Total tests written**: 22 (5 domain + 7 contracts assertions/guards total file count + 10 API schema)
- **Total tests passing**: 92 targeted tests (15 domain + 26 contracts + 51 API)
- **Layers used**: Unit (22 new checks)
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
| `apps/api/src/db/schema.ts` | Modified | Added workout tracking enum/tables/indexes |
| `apps/api/drizzle/0005_workout_tracking.sql` | Created | Additive SQL migration with single-active-session unique guard |
| `openspec/changes/implement-09a-v1-workout-tracking-core/tasks.md` | Modified | Marked Phase 1 tasks complete |

---

## Verification Results

```text
pnpm --filter @kinora/domain test src/__tests__/rpe.test.ts src/plan/__tests__/session-duration.test.ts
  2 files passed, 14 tests passed
```

```text
pnpm --filter @kinora/contracts test src/__tests__/exports-conditions.test.ts src/contracts.test.ts src/__tests__/workout-program.test.ts
  3 files passed, 26 tests passed
```

```text
pnpm --filter api test src/db/__tests__/auth-schema.test.ts src/db/__tests__/plan-schema.test.ts src/db/__tests__/workout-plan-schema.test.ts src/db/__tests__/workout-tracking-schema.test.ts
  4 files passed, 51 tests passed
```

```text
pnpm type-check
  Passed after restoring local workspace dependencies with `pnpm install --frozen-lockfile`.
  No lockfile or package.json changes were required.
```

```text
pnpm architecture
  Passed.
pnpm deps-guard
  Passed.
pnpm test
  Passed: contracts 32, mobile 34, domain 90, api 509, web 514 tests.
pnpm build
  Passed.
```

---

## Deviations from Design

None — implementation matches the Phase 1 design boundary. The schema uses a PostgreSQL enum plus a partial unique index to enforce the single active session invariant.

---

## Workload / PR Boundary

- Mode: stacked PR slice
- Current work unit: PR1 contracts/domain + schema/migration
- Boundary: includes only contracts, pure domain validation, schema tests, and additive migration/schema work; excludes API routes/repos and web wiring
- Estimated review budget impact: moderate but focused to Phase 1 foundation only

---

## Remaining Tasks

- [ ] 2.1 RED: add repository tests in `apps/api/src/db/repositories/__tests__/workout-session.test.ts` for snapshot start, tenant/user 404 lookup, set writes, completion, and active-session reuse.
- [ ] 2.2 GREEN: implement `apps/api/src/db/repositories/workout-session.ts` with tenant+user-scoped methods and immutable snapshot creation from `workoutPlans.programJson`.
- [ ] 2.3 RED/GREEN: add route tests in `apps/api/src/routes/__tests__/workout-session.test.ts` for 401, 404, 422, and “start existing active session” behavior.
- [ ] 2.4 GREEN: create `apps/api/src/routes/workout-session.ts` and register it in `apps/api/src/app.ts`; map bad RPE/body to 422 and mismatches to 404.
- [ ] 3.1 RED: add web tests for start/resume actions and live tracker rendering in `apps/web/src/app/(app)/plan/[id]/__tests__/tracker.test.tsx` (or the nearest existing plan tests).
- [ ] 3.2 GREEN: add server actions in `apps/web/src/app/(app)/plan/[id]/actions.ts` (or a new tracker actions file) to start, fetch, record sets, and complete via the httpOnly session cookie.
- [ ] 3.3 GREEN: build the tracker/exercise UI under `apps/web/src/app/(app)/plan/[id]/` and wire the start CTA from the ready-plan view; omit analytics/offline controls.
- [ ] 3.4 GREEN: add required copy to `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/es.json`, then keep catalog parity green.
- [ ] 4.1 RED/GREEN: extend API/web tests for snapshot immutability, valid/invalid RPE, and same-tenant cross-user no-data behavior.
- [ ] 4.2 Run `pnpm type-check`, `pnpm test`, `pnpm architecture`, `pnpm deps-guard`, and `pnpm build`; fix only 09a regressions.
