# Design: Implement 09a — Workout Tracking Core

## Technical Approach

Add an online workout-tracking slice beside the existing plan-generation flow. The API will use protected Fastify routes (`requireAuth`), tenant+user-scoped repositories, and DTO mapping before responses. Starting a session reads a ready `workoutPlans.programJson`, snapshots the selected `WorkoutSession` into relational tracking rows, then records set results against that immutable snapshot. Contracts stay DTO-only; RPE validation lives in pure domain code.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Snapshot on start | Copy planned session/exercise/set context from `workout_plans.program_json` into `workout_sessions` + child rows. | Store only JSON indexes into the generated plan. | Snapshots preserve workout history after regenerate/edit and keep tracker reads relational instead of coupled to mutable JSON. |
| Naming collisions | DB names: `workout_sessions`, `session_exercises`, `set_records`; contract names: `WorkoutSessionRecord`, `SessionExerciseRecord`, `SetRecordDTO`. | Reuse `sessions` / `WorkoutSession`. | `sessions` is auth tokens and `WorkoutSession` already means generated plan day; explicit tracking names prevent ambiguous imports and migrations. |
| Tenant/user scoping | Repository reads require `(tenantId, userId, id)` and return `undefined`; routes map that to `404 { error: "not_found" }`. | Return 403 on cross-tenant/user mismatch. | Matches existing `WorkoutPlanRepository` + `plan.ts` convention and avoids resource existence leaks. |
| Single active session | Enforce at most one active `workout_sessions` row per `(tenantId, userId)` while status is active; start returns/resumes the existing active session. | Allow many active sessions and let UI choose. | The first online tracker slice should avoid duplicate in-progress workouts and keep resume behavior deterministic. |
| RPE validation | Add framework-free `validateRpe` / assertion in `packages/domain/src/plan` and call it from API boundary logic before persistence. | Validate only with Fastify schema or UI constraints. | Domain rule must be reusable and testable without web/API frameworks; boundary still rejects invalid requests. |
| API/web boundary | Browser calls Next Server Actions; actions forward the httpOnly session token to API client helpers, never direct browser API fetch. | Client component fetches API directly. | Preserves current `plan-draft-client.ts` pattern and keeps bearer tokens server-side. |
| Migration/rollback | Add additive tables/enums only; rollback drops tracking tables/enums and route/web changes. | Mutate existing plan/auth tables. | Existing plans and auth sessions remain intact; rollback does not affect generated programs. |

## Data Flow

```text
Plan detail CTA ──Server Action──> POST /workout-sessions
       │                              │ requireAuth
       │                              ▼
       │                    WorkoutSessionRepository
       │                              │ reads ready workout_plan
       │                              ▼
       │             transaction: session + exercises + set records
       ▼                              │
Tracker UI <──DTO mapping── GET/PATCH /workout-sessions/:id
```

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/db/schema.ts` | Modify | Add tracking enums/tables, tenant/user FKs, and unique active-session guard. |
| `apps/api/drizzle/<next>_*.sql` | Create | Add/drop migration for tracking schema. |
| `apps/api/src/db/repositories/workout-session.ts` | Create | Start, find, record set, complete methods; tenant+user scoped. |
| `apps/api/src/routes/workout-session.ts` | Create | Protected session/set endpoints with DTO mapping and 401/404/422 behavior. |
| `apps/api/src/app.ts` or route registration file | Modify | Register workout-session routes. |
| `apps/api/src/plan/boundary.ts` | Modify | Add request/body guards for tracking DTOs if route-local schemas are insufficient. |
| `packages/contracts/src/index.ts` | Modify | Export tracking DTOs using non-colliding names. |
| `packages/domain/src/plan/rpe.ts`, `index.ts` | Create/Modify | Pure RPE validator exports. |
| `apps/web/src/app/(app)/create-plan/plan-draft-client.ts` | Modify | Add server-only API helpers for start/fetch/record/complete. |
| `apps/web/src/app/(app)/plan/**` | Modify/Create | Add start CTA, live tracker page, exercise execution UI, actions, CSS, i18n keys. |

## Interfaces / Contracts

```ts
type WorkoutSessionRecordStatus = "active" | "completed";
interface WorkoutSessionRecord { id: string; workoutPlanId: string; status: WorkoutSessionRecordStatus; exercises: SessionExerciseRecord[]; startedAt: string; completedAt?: string; }
interface SetRecordDTO { id: string; sessionExerciseId: string; setIndex: number; targetReps: string; actualReps?: number; weightKg?: number; rpe?: number; completed: boolean; notes?: string; }
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | RPE accepts 0/5/10, rejects below/above/non-numeric. | Vitest in `packages/domain`. |
| Repository | Snapshot transaction, single active-session reuse, tenant/user mismatch `undefined`, completion blocks active writes. | Mocked Drizzle chains plus SQL shape tests. |
| Routes | 401 unauthenticated, 404 mismatch, 422 invalid RPE/body, DTO no internal columns. | Fastify `inject` tests mirroring `plan.test.ts`. |
| Web | Server Action token forwarding, tracker render, no analytics/offline controls. | Existing Next/Vitest component and helper tests. |

## Migration / Rollout

Additive migration only. Deploy API after schema migration, then web CTA/tracker. Rollback removes web entry points/routes and drops tracking tables; generated plans/auth data are unaffected.

## Open Questions

None.
