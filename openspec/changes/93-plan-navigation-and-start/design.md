# Design: Plan Navigation and Start (Issue #93)

## Technical Approach

Three ordered, independently-mergeable slices. Slice 1 lands both nullable DB columns plus the repo/contract wiring (the only slice that must ship first). Slice 2 threads the plan name end-to-end through a SHARED contract DTO (`WorkoutPlanSummary`/`WorkoutPlanDetail` in `packages/contracts`) projected in BOTH the list and detail API paths, with the blank→default resolved once server-side. Slice 3 unblocks the start CTA in `DayDetailPanel` and makes `startSession` scope-aware with an explicit conflict signal. The `startSession(tenantId, userId, planId, day)` signature and the `POST /workout-sessions {workoutPlanId, day}` route ALREADY exist and validate `day` — the current bug is that `day` is neither persisted nor used in the active-session lookup, and the conflict case collapses into a silent wrong-session return / generic 404.

## Architecture Decisions

### Decision 1 — Where the tracker renders when started from `/plan`

| Option | Tradeoff | Decision |
|--------|----------|----------|
| (a) Inline state-swap on `/plan` (reuse PlanStatusClient pattern) | Meets SC "without navigating to `/plan/[id]`"; needs a new client wrapper around PlanWeekView; DayDetailPanel gains an `onStartWorkout` callback prop | **CHOSEN** |
| (b) Navigate to `/plan/[id]` with a start intent | Simpler wiring but violates the explicit success criterion and regresses UX (extra route hop) | Rejected |

**Choice**: Option (a). Introduce a thin `"use client"` wrapper `PlanTrackerClient` (mirrors `PlanStatusClient`'s `activeSession` state-swap). `PlanWeekView` (server) renders it, passing `program` + `planId` + `messages`. The wrapper holds `activeSession` / `conflict` state, renders `DayDetailPanel` normally, and swaps to `TrackerPanel` (reused verbatim from `[id]/`) once a session starts. `DayDetailPanel` stays presentational: it gains an `onStartWorkout(day)` prop and a `conflict` prop, never fetches. **The existing `/plan/[id]` flow is untouched** — `PlanStatusClient` keeps its own copy of the swap logic; we reuse `TrackerPanel` and the `[id]/actions.ts` server actions, we do not modify them.

**Rationale**: The full data path (server action → tracker-client → route → injected repo) already exists and is #85-compliant. Reusing it inline is the smallest change that satisfies the criterion without duplicating the API boundary.

### Decision 2 — Active-session 3-branch logic

`findLatestActiveSession(tenantId, userId)` stays user-scoped (the `singleActivePerUser` index guarantees ≤1 active row, so a plan/day filter in SQL is unnecessary — we fetch the one active row, then compare in code). `startSession` becomes:

```
active = findLatestActiveSession(tenantId, userId)   // ≤1 by DB invariant
if active:
  if active.workoutPlanId === planId && active.day === day  → resume (findById)   // branch A
  else                                                       → CONFLICT             // branch B
// no active session                                          → create new row     // branch C (writes day)
```

- **NULL-day fallback**: old rows have `day = null`. `null === day` is always false, so any pre-migration active session takes branch B (conflict), never silently resuming — matches the proposal contract.
- **Conflict signal**: `startSession` returns a discriminated result instead of `WorkoutSessionRecord | undefined`. New repo return type: `StartSessionOutcome = { kind: "started" | "resumed"; session } | { kind: "conflict"; activePlanId; activePlanName?; activeDay: number | null }`. The route maps `conflict` → **HTTP 409** `{ error: "active_session_conflict", activePlanName, activeDay }`; `undefined`/not-ready → 404 (unchanged). tracker-client's `parseWorkoutSessionResponse` maps 409 to `{ kind: "error", message: "active_session_conflict" }` plus the payload fields. The server action returns the error result (stop throwing on conflict — see Slice 3). `PlanTrackerClient` sets `conflict` state and `DayDetailPanel` shows the localized banner ("Tienes una sesión activa para {plan} · Día {n}").

### Decision 4 — Where the plan-name type lives (Slice 2)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| (a) Shared DTO in `packages/contracts/src` — add `name?: string` to a plan contract (`WorkoutPlanSummary` + plan-detail shape) consumed by web AND future mobile | One source of truth across clients; slightly more surface (a contract type + web types re-referencing it) | **CHOSEN** |
| (b) Web-only — add `name?` only to the web `plan-draft-client.ts` types (`PlanSummary`, `PlanStatusResponse`) | Smallest diff, no contracts churn; NOT reusable — mobile would redeclare the field and drift | Rejected |

**Choice**: Option (a). `packages/contracts` already owns `PlanSpec`, `WorkoutProgram`, and `WorkoutSessionRecord`, so the plan DTOs belong there. Add `name?: string` to a shared `WorkoutPlanSummary` (list) and a shared plan-detail shape (`WorkoutPlanDetail`, matching the client DTO `{ id, status, program, specId, name? }`). The web `PlanSummary`/`PlanStatusResponse` in `plan-draft-client.ts` re-use / structurally match these contracts; the API route's inline `PlanSummary`/`PlanRecord` structural shapes gain `name?` too.

**Rationale**: This is a monorepo WITH a mobile foundation. The plan list + detail are exactly the surfaces mobile will consume. Keeping `name` web-only guarantees mobile drift and a second default-name implementation. The extra surface is one contract field; the reuse payoff is a single source of truth. #85 route-layer compliance is preserved — routes still import only the injected port and structural DTO types, never `db/**`.

### Decision 3 — Migration shape

Both columns nullable and additive: `workout_plans.name VARCHAR(120)` (Drizzle `varchar("name", { length: 120 })`), `workout_sessions.day SMALLINT` (Drizzle `smallint("day")`). No backfill; no index change; `singleActivePerUser` untouched. Drop-column rollback is data-loss-safe. Generated via `pnpm drizzle-kit generate` (project convention — do not hand-write SQL).

## Data Flow (Slice 3 start CTA — proves #85 compliance)

    DayDetailPanel (client, presentational)
       │  onStartWorkout(day)
       ▼
    PlanTrackerClient (client)  ── activeSession/conflict state-swap
       │  startWorkoutSessionAction(planId, day)   ← existing server action
       ▼  "use server" (server-only, reads httpOnly cookie)
    tracker-client.startWorkoutSession → fetch(API_BASE_URL + /workout-sessions)
       ▼
    routes/workout-session.ts  (injected WorkoutSessionRouteRepo — NO db import)
       ▼
    WorkoutSessionRepository.startSession → Drizzle
       └─ 409 conflict / 200 session ──▶ back up the chain

Browser never sees `API_BASE_URL`; route imports only the injected port (`options.repo`). No `routes/** → db/**` import. Pattern is already established by #85.

## Slice 2 — Plan-name projection (list + detail)

`name` must flow through BOTH read paths, not just the wizard write:

- **List path**: `WorkoutPlanRepository.findAllByUser` uses an explicit `.select({ id, status, createdAt })` — `name: workoutPlans.name` MUST be added to that projection. `WorkoutPlanSummary` (repo) and the route's inline `PlanSummary` gain `name`; `GET /workout-plans` maps `s.name` into each item. `fetchUserPlans`/web `PlanSummary` receive `name?`.
- **Detail path**: `findById` selects `*`, so `name` is present on the row once the column exists; but the route's inline `PlanRecord` structural shape and the `GET /workout-plans/:id` response map (`{ id, status, program, specId }`) MUST add `name`. The web `FetchPlanResult.plan` type (`PlanStatusResponse`) gains `name?`, which is what `PlanWeekView`/`plan/page.tsx` read as `plan.name` — without this, `plan.name` is always `undefined` and won't type-check against the shared contract. `GET /plan-specs/:id/workout-plan` maps `name` identically (same client DTO).
- **Route-layer compliance (#85)**: both routes keep importing only the injected `PlanRouteRepo` port + structural DTO types — no `db/**` import. The `findPlanById`/`findAllPlansByUser` adapters in `app.ts` map the DB row's `name` into the port's structural shape.

**Auto-default at a single layer**: the blank→default rule is computed by the domain helper `defaultPlanName(name, createdAt)` and applied **on read/display**, NOT only on wizard write. The wizard MAY persist a blank/omitted name (stored as `null`); the effective label is derived when displayed so list, detail header, and selector all show the SAME value. To keep list and detail consistent, the API maps `name: defaultPlanName(row.name, row.createdAt)` in BOTH `findAllPlansByUser`/`findPlanById` adapters (server-side, single source), so the contract `name` is always a resolved non-empty string; the web header/selector render `plan.name` directly (no client-side fallback branching). Rationale: computing once server-side beats duplicating the fallback in web + mobile.

## File Changes

| File | Action | Slice |
|------|--------|-------|
| `apps/api/src/db/schema.ts` | Modify — add `name` to `workoutPlans`, `day` to `workoutSessions` | 1 |
| `apps/api/drizzle/*` migration | Create — generated additive ALTER | 1 |
| `packages/contracts/src/index.ts` | Modify — `WorkoutSessionRecord.day?: number`; new `StartSessionOutcome`; add `name?: string` to shared `WorkoutPlanSummary` + new/extended `WorkoutPlanDetail` (`{ id, status, program?, specId, name? }`) | 1 |
| `packages/domain/src/plan/default-plan-name.ts` (+ `index.ts` re-export) | Create — `defaultPlanName(name: string \| null \| undefined, createdAt): string`; day validation reuse (route already `minimum:1`) | 1/2 |
| `apps/api/src/db/repositories/workout-plan.ts` | Modify — add `name` to `findAllByUser` `.select({...})` + `WorkoutPlanSummary`; `findById` already `select(*)` so `name` present; `WorkoutPlanRecord` gains `name` | 2 |
| `apps/api/src/routes/plan.ts` | Modify — inline `PlanRecord.name?` + `PlanSummary.name`; map `name` into `GET /workout-plans`, `GET /workout-plans/:id`, `GET /plan-specs/:id/workout-plan` responses | 2 |
| `apps/api/src/app.ts` (composition root) | Modify — `findPlanById`/`findAllPlansByUser` adapters map `name: defaultPlanName(row.name, row.createdAt)` into the port shape (single default layer) | 2 |
| `apps/web/.../create-plan/plan-draft-client.ts` | Modify — `PlanSummary.name?`, `PlanStatusResponse.name?` (matches shared contract; `FetchPlanResult.plan` now carries `name`) | 2 |
| `apps/api/src/db/repositories/workout-session.ts` | Modify — persist `day` on insert; 3-branch logic; return `StartSessionOutcome`; `findById`/`mapWorkoutSessionRecord` include `day` | 1(logic) |
| `apps/api/src/routes/workout-session.ts` | Modify — map `conflict`→409 | 3 |
| `apps/web/.../plan/[id]/tracker-client.ts` | Modify — surface 409 payload fields | 3 |
| `apps/web/.../plan/[id]/actions.ts` | Modify — `startWorkoutSessionAction` returns result (no throw on conflict) | 3 |
| `apps/web/.../plan/PlanTrackerClient.tsx` | Create — state-swap wrapper | 3 |
| `apps/web/.../plan/PlanWeekView.tsx` | Modify — render `PlanTrackerClient`, pass `planId`; add plan-name header | 2/3 |
| `apps/web/.../plan/page.tsx` | Modify — thread `plan.name` (already resolved server-side) + `planId` | 2/3 |
| `apps/web/.../plan/DayDetailPanel.tsx` | Modify — CTA button + conflict banner; remove deferred marker (`:174`) | 3 |
| `apps/web/.../create-plan/*` (wizard) | Modify — optional name field → `PlanSpec`/draft | 2 |
| `apps/web/.../plan/PlanSelector.tsx` | Modify — render `plan.name` (already resolved server-side; no client fallback) | 2 |
| `apps/web/src/i18n/en.json`,`es.json` | Modify — CTA, conflict, name keys | 2,3 |

## Interfaces

```ts
// contracts
interface WorkoutSessionRecord { /* … */ day?: number }   // optional = additive
type StartSessionOutcome =
  | { kind: "started" | "resumed"; session: WorkoutSessionRecord }
  | { kind: "conflict"; activePlanId: string; activePlanName?: string; activeDay: number | null };

// Shared plan DTOs (contracts) — one source of truth for web + mobile
interface WorkoutPlanSummary { id: string; status: string; createdAt: string; name?: string }
interface WorkoutPlanDetail  { id: string; status: string; program?: WorkoutProgram; specId: string; name?: string }
// name is resolved server-side via defaultPlanName(row.name, row.createdAt) before it
// reaches the contract, so clients receive a non-empty label and never branch on null.

// domain
function defaultPlanName(name: string | null | undefined, createdAt: Date | string): string;
```

i18n keys: `plan_day_start_cta`, `plan_start_conflict` ("You have an active session for {plan} · Day {n}"), `plan_name_field_label`, `plan_name_default` ("Plan {n}").

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit (repo) | 3 branches: resume(match), conflict(mismatch), conflict(null-day), create(none) persists `day` | Vitest, in-memory/mock db mirroring existing `workout-session` repo tests |
| Unit (route) | conflict→409 payload; new session→200; not-ready→404 | existing `routes/__tests__/workout-session.test.ts` |
| Unit (repo/route) | `findAllByUser` select includes `name`; `GET /workout-plans` + `GET /workout-plans/:id` responses carry `name`; `defaultPlanName` blank/null → default, non-blank → passthrough | existing `workout-plan` repo tests + `routes/__tests__` |
| Unit (web) | DayDetailPanel renders CTA + conflict banner; PlanTrackerClient swap; PlanSelector + plan header render resolved `plan.name` | existing `__tests__` dirs |
| Integration | migration additive; single-active index still rejects 2nd active | drizzle migration + repo test |

## Migration / Rollout

Additive nullable columns, no backfill, no flag. Slices land sequentially to `main`; each is a safe `git revert`; columns drop cleanly.

## Open Questions

- [x] Plan-name auto-default shape: RESOLVED — date-based `defaultPlanName(name, createdAt)` (no extra ordinal query), applied server-side on read in both list + detail adapters so clients receive a resolved label.
