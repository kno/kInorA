# Tasks: Implement 09a — Workout Tracking Core

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 500-700 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 contracts/domain + schema/migration → PR 2 API repo/routes → PR 3 web tracker/actions → PR 4 verification |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Contracts, domain RPE, tracking schema | PR 1 | Base = main; merge before PR 2. |
| 2 | Session repository + API routes | PR 2 | Base = main after PR 1; includes single-active-session reuse. |
| 3 | Tracker UI + server actions | PR 3 | Base = main after PR 2; keep analytics/offline controls out. |
| 4 | Verification and cleanup | PR 4 | Base = main after PR 3; final tests, docs, and guard checks. |

## Phase 1: Foundation / Schema

- [x] 1.1 RED: add unit tests for `validateRpe` in `packages/domain/src/__tests__/rpe.test.ts` and export-shape checks for new tracking DTO names in `packages/contracts/src/__tests__/exports-conditions.test.ts`.
- [x] 1.2 GREEN: implement `packages/domain/src/plan/rpe.ts`, export it from `packages/domain/src/plan/index.ts` and `packages/domain/src/index.ts`.
- [x] 1.3 GREEN: add `WorkoutSessionRecord`, `SessionExerciseRecord`, and `SetRecordDTO` to `packages/contracts/src/index.ts` without colliding with generated-plan `WorkoutSession`.
- [x] 1.4 RED/GREEN: add schema tests, then create `workout_sessions`, `session_exercises`, and `set_records` in `apps/api/src/db/schema.ts` plus `apps/api/drizzle/<next>_workout_tracking.sql` with the single-active-session unique guard.

## Phase 2: API Core

- [x] 2.1 RED/GREEN: add `findById` repository tests and implementation for tenant/user-scoped session reads with exercises and set records.
- [ ] 2.2 RED/GREEN: add repository tests and implementation for immutable snapshot start plus active-session reuse.
- [ ] 2.3 RED/GREEN: extend repository tests and implementation for set writes and session completion.
- [ ] 2.4 RED/GREEN: add route tests in `apps/api/src/routes/__tests__/workout-session.test.ts` for 401, 404, 422, and “start existing active session” behavior.
- [ ] 2.5 GREEN: create `apps/api/src/routes/workout-session.ts` and register it in `apps/api/src/app.ts`; map bad RPE/body to 422 and mismatches to 404.

## Phase 3: Web Tracker Surface

- [ ] 3.1 RED: add web tests for start/resume actions and live tracker rendering in `apps/web/src/app/(app)/plan/[id]/__tests__/tracker.test.tsx` (or the nearest existing plan tests).
- [ ] 3.2 GREEN: add server actions in `apps/web/src/app/(app)/plan/[id]/actions.ts` (or a new tracker actions file) to start, fetch, record sets, and complete via the httpOnly session cookie.
- [ ] 3.3 GREEN: build the tracker/exercise UI under `apps/web/src/app/(app)/plan/[id]/` and wire the start CTA from the ready-plan view; omit analytics/offline controls.
- [ ] 3.4 GREEN: add required copy to `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/es.json`, then keep catalog parity green.

## Phase 4: Verification / Cleanup

- [ ] 4.1 RED/GREEN: extend API/web tests for snapshot immutability, valid/invalid RPE, and same-tenant cross-user no-data behavior.
- [ ] 4.2 Run `pnpm type-check`, `pnpm test`, `pnpm architecture`, `pnpm deps-guard`, and `pnpm build`; fix only 09a regressions.
