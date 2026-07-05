# Proposal: Implement 09a — Workout Tracking Core

## Intent

Implement accepted `09a-v1-workout-tracking-core`: authenticated users can start a live workout, view exercise context, record sets/RPE/notes, and complete sessions before offline history or analytics.

## Scope

### In Scope
- Online session CRUD + live tracker and exercise execution surfaces.
- Snapshot planned exercise data from `workoutPlans.programJson` when a session starts.
- Tenant/user-scoped routes/repos; mismatch returns 404/no data.
- RPE validation in pure domain code, constrained to 0-10.
- Naming: DB tables use `workout_sessions`, `session_exercises`, `set_records`; contracts avoid generated-plan `WorkoutSession`, e.g. `WorkoutSessionRecord`.

### Out of Scope
- Progress analytics/statistics → `09c-v1-progress-dashboard-stats`.
- Offline capture/sync/history → `09b-v1-workout-offline-history`.
- Regenerating or editing AI plans.

## Product Decisions

- Enforce one active workout session per user; starting another session should resume or return the existing active session instead of creating a duplicate.
- Snapshots preserve history over plan edits.
- First slice prioritizes safe online logging over analytics, offline UX, or advanced rest automation.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `09a-v1-workout-tracking-core`: implement accepted requirements and clarify model/status semantics, 404-on-mismatch, snapshot-on-start, and non-colliding DB/contract names.

## Approach

Follow existing plan/auth patterns: `requireAuth`, validated DTOs, tenant+user repository methods, no raw Drizzle rows across boundaries. On start, read the ready plan, copy selected session/exercise/set plan into relational rows, then log sets against that snapshot. Keep contracts DTO-only and domain validation framework-free.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` + migrations | New | Tracking tables; avoid auth `sessions`. |
| `apps/api/src/db/repositories/` | New | Tenant/user-scoped tracking repositories. |
| `apps/api/src/routes/` | New | Protected session/set endpoints; 401/422/404 mapping. |
| `packages/contracts/src/index.ts` | Modified | Tracking DTOs with non-conflicting names. |
| `packages/domain/src/` | Modified | Pure RPE validation. |
| `apps/web/src/app/(app)/plan/` | Modified | Tracker/exercise UI. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Name collisions | Med | Use explicit tracking names. |
| Snapshot duplication | Med | Treat snapshots as historical truth. |
| 403 vs 404 inconsistency | Med | Document 09a as 404/no-data. |
| Analytics/offline creep | High | Keep 09b/09c deferred. |

## Rollback Plan

Revert API/web/contracts/domain changes and drop the tracking migration. Existing auth sessions, plans, and generated `WorkoutProgram` data remain intact.

## Dependencies

- `01c-v1-multi-tenant-schema`, `05a-v1-auth-core`, `05b-v1-security-tenant-validation`, `08-v1-ai-plan-generation`.

## Success Criteria

- [ ] Users can start, view, update, and complete an online session.
- [ ] Sets store reps, weight, completion status, notes, and valid RPE only.
- [ ] Tenant/user mismatches return 404/no session data.
- [ ] Tracking remains stable if the source plan changes later.
