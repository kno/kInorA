# Exploration — 17b-stale-session-recovery

Source issue: [kno/kInorA#367](https://github.com/kno/kInorA/issues/367) — "tracker: a stale active session blocks every workout start, and the 409 is swallowed silently".

Read-only investigation. No code changed.

## 1. Current behaviour, with evidence

### Start-session path (web `/plan`)

1. Hero CTA / `DayDetailPanel` "Start session" → `PlanTrackerClient.handleStartWorkout` (`apps/web/src/app/(app)/plan/PlanTrackerClient.tsx:198-206`)
2. → `useWorkoutSession().handleStartWorkout` (`apps/web/src/app/(app)/plan/use-workout-session.ts:431-465`)
3. → Server Action `startWorkoutSessionAction` (`apps/web/src/app/(app)/plan/[id]/actions.ts:112-136`)
4. → API `POST /workout-sessions`

### API branching

`startSession` (`apps/api/src/db/repositories/workout-session.ts:279-347`):

- **Branch A** — active session for the same plan + day → `resumed` (200, no conflict)
- **Branch B** — active session for a different plan/day, or a legacy `null`-day row → `{ kind: "conflict", activePlanId, activePlanName, activeDay }`
- **Branch C** — no active session → `started` (200)

The route (`apps/api/src/routes/workout-session.ts:134-162`) maps `conflict` to `409 { error: "active_session_conflict", activePlanName, activeDay }`.

### Correction to the issue's premise (verified)

The issue states that `PlanTrackerClient` "already threads a `conflict` value through — the plumbing exists and is not being rendered to a conclusion". **The second half of that claim is false in the current codebase.**

- `handleStartWorkout` calls `setConflict(...)` (`use-workout-session.ts:441-445`); the hook documents a 409 as a normal structural branch, not an error (`use-workout-session.ts:27-28`).
- `DayDetailPanel` renders a localized banner: `role="alert"`, `data-testid="start-conflict"` (`DayDetailPanel.tsx:129-133`), with three message variants derived at `DayDetailPanel.tsx:94-102` (`plan.start.conflict`, `plan.start.conflict_no_day`, `plan.start.conflict_generic`).
- The same banner exists on `/plan/[id]` (`PlanStatusClient.tsx:174-193`) and on mobile (`WorkoutTrackerScreen.tsx:871-885`).

The real gap for scope A is therefore narrower and different from what the issue describes:

1. **The banner is read-only text.** No resume action, no discard action. The user is told they are blocked and given no exit — which is defect #2 in the issue, not defect #1.
2. **Placement.** On `/plan`, the banner renders inside `DayDetailPanel` (the week-board section), not co-located with the Hero's primary "Start session" CTA that most likely triggered it. There is no scroll-into-view and no focus management. This plausibly explains the reported "every start button appeared dead" — a banner existed elsewhere in the DOM and was never seen.
3. **The banner never names the date** the blocking session started. It names plan and day-of-week number only. The issue explicitly asks for the date, and a 5-day-old session is exactly the case where the date is the load-bearing information.

### Two distinct 409 shapes — confirmed

| Shape | Endpoint | Payload | Client consumers |
| --- | --- | --- | --- |
| Rich | `POST /workout-sessions` (`workout-session.ts:151-156`) | `{ error, activePlanName, activeDay }` | Parsed and rendered by web `/plan`, web `/plan/[id]`, and mobile |
| Bare | `DELETE /workout-sessions/:id` (`:260-261`) and `DELETE /workout-sessions` (`:279-280`) | `{ error: "active_session_conflict" }` | **None found.** Grep for `deleteAllByUser` / `deleteById` / `active_conflict` across `apps/web/src` returned zero UI call sites |

The bare shape comes from the `10c-workout-session-delete` guard (`workout-session.ts:501-537`, `547-586`). It is not a swallowed error — it currently has no client caller at all.

## 2. The abandonment threshold

`ABANDONED_SESSION_THRESHOLD_HOURS = 24` — `apps/api/src/db/repositories/admin-stats.ts:50`.

Consumers today:

- `getRetentionFunnel` abandoned sub-query (`admin-stats.ts:304`) — counts `status = 'active'` rows older than the threshold
- Exposed in the stats payload as `abandonedSessionThresholdHours` (`admin-stats.ts:415`)
- Integration test (`apps/api/src/db/repositories/__tests__/admin-stats.integration.test.ts:50, 461, 478`)

It is **informational/admin-only** today. Reusing it for scope B is directionally right — it avoids a second magic number, and the issue asks for exactly this. But note the role change: from a *statistics cutoff* to a *behavioural cutoff* that decides whether a user can train. Importing an admin-stats constant into the core session repository is also a layering smell. Relocating the constant to a shared location is a design-phase decision.

## 3. `workout_sessions.status` blast radius

Current domain: `"active" | "completed"`. Single DTO source of truth: `packages/contracts/src/index.ts:58` (`WorkoutSessionRecordStatus`).

**Every direct SQL predicate uses exact-match equality (`eq`), never inequality.** Adding a third value is therefore additively safe for existing filters. The risk is not in the SQL — it is in the call sites where `active` is used as a stand-in for "the one blocking, resumable session".

### Needs an explicit decision

| Call site | Location | Why it matters |
| --- | --- | --- |
| `findLatestActiveSession` | `workout-session.ts:~1416-1427` | Backs `startSession`'s conflict check. Naturally stops matching once a row is written `abandoned` |
| `completeSession` | `workout-session.ts:453-480` | Guards on `status = 'active'` — can an abandoned session still be completed? |
| `deleteById` / `deleteAllByUser` | `workout-session.ts:501-586` | Same guard |
| `recordSet` | `workout-session.ts:387-397` | Same guard — is an abandoned session still writable, i.e. resumable? |

### Highest-risk read

**The #353 retention funnel.** It currently *infers* abandonment from `status = 'active'` plus age (`admin-stats.ts:304`). Once scope C writes a real `abandoned` status, this query must switch to reading `status = 'abandoned'` or it will double-count or undercount depending on write timing. This is the single most important read to get right.

### Unaffected (filter `completed`-only)

- `getDashboardSummary` (`workout-session.ts:706-822`)
- `getClientDashboard` (`:842-899`)
- `listCompletedSessions` (`:615-690`)
- Muscle-group distribution, `getStatsRange` (`:~1091`)

### Non-API status checks

Only two, both `isCompleted` derivations with no `else`-assumes-active branch:

- `apps/mobile/src/screens/tracker/tracker-logic.ts:249`
- `apps/web/src/app/(app)/plan/[id]/tracker/tracker-model.ts:116`

Widening the contracts union will make TypeScript flag exhaustive checks — a useful forcing function.

### Coverage caveat

`getWeeklyOverview` (`~1256`) and `getExerciseDetail` (`~1338`) were flagged by codegraph as `workoutSessions` consumers but their status filtering was **not** verified by opening the source. Confirm during design or apply.

## 4. Swallowed-error inventory (scope D)

Confirmed instances:

- `apps/web/src/app/(app)/plan/[id]/PlanStatusClient.tsx:138-144` — `handleRegenerate` catch block is `catch { /* Network error — user can try again */ }`. No error state, no UI feedback.
- `apps/web/src/app/(app)/plan/DayDetailPanel.tsx:85-90` — `navigateWeek` handles only `result.kind === "ok"`. No `else`. A failed week-navigation fetch silently keeps the stale week with no error and no retry affordance.

Counter-example worth generalizing into the pattern the sweep should enforce:

- `apps/mobile/src/api/plan-status-client.ts` + `PlanStatusScreen.tsx` — every result is a discriminated `{ kind: "error", ... }` rendered into a named `phase`. Nothing is dropped.

### Honesty about coverage

Searched: `apps/web/src/app/(app)/plan/**`, `apps/mobile/src/screens/**`, and the create-plan proxy routes (chat / speech / transcribe — all pass errors through verbatim, not swallowed).

**Not searched:** a full repo-wide sweep of every `fetch` / `try-catch` in web and mobile. Billing, memory, exercises, trainer and clients screens are entirely untouched by this pass.

Scope D as the issue frames it — "the durable fix", "the point of this issue" — is materially undersized by this exploration. Recommendation: it becomes its own dedicated audit and PR rather than being folded into this change's 800-line budget.

## 5. Open questions — genuine product decisions

1. **Scope B: auto-close vs. allow-alongside.** Auto-closing risks silently discarding real in-progress set data (the blocking session in the incident held 1 completed set of 15). Allowing a second session alongside breaks the single-active-session invariant, which is load-bearing — it is enforced today by a user-row lock inside `startSession`'s transaction (`workout-session.ts:325-346`) and assumed by at least three repository methods.
2. **Scope C: stored enum value vs. derived state.** Stored requires a migration plus a write path (a sweep job, or an on-conflict transition) and has no backfill signal for pre-#352 rows — the same "no backfill" precedent already set by `muscleGroup` (`workout-session.ts:88-96`). Derived, as admin-stats already does, needs no schema change but cannot represent a stable "this session was abandoned" fact after the fact.
3. **Should the bare DELETE 409 shape be enriched?** Possibly moot — it has no current client caller.

## 6. Rough size signal

| Scope | Order of magnitude | Notes |
| --- | --- | --- |
| A | ~150–300 lines | Mostly UI: resume/discard actions across 3 clients + i18n. Conflict-state plumbing already exists, so smaller than the issue implies |
| B | ~80–150 lines | One repository branch change + tests. Entangled with C if auto-close needs the new status |
| C | ~200–400 lines | Migration, contracts widen, funnel query rewrite, cross-app consumer checks. Highest risk |
| D | Unbounded | Recommend a separate follow-up issue and PR |

**Suggested chaining:** A (standalone, low risk) → B + C together (one PR — B's auto-close path may require C's status, and C requires the funnel rewrite) → D as a separate issue.

## Risks carried forward

- Scope D is undersized by this pass and should not be scoped from this exploration alone.
- The #353 retention funnel rewrite is the highest-risk single read in scope C.
- The single-active-session invariant is load-bearing in three or more repository methods and must be revisited explicitly if scope B chooses allow-alongside.
