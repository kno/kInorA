# Archive Report — 17b-stale-session-recovery

**Closed:** 2026-08-07 · **Source issue:** [kno/kInorA#367](https://github.com/kno/kInorA/issues/367) · **Verification:** passed, 0 CRITICAL

## What was delivered

A workout session that has been abandoned is now recorded as such, stops blocking the user, and loses no data. Unblocking a stuck user no longer requires production database access — which was the incident that opened the issue.

Three PRs, stacked to main, all merged and deployed to production.

| PR | Commit | Scope | Size |
|---|---|---|---|
| [#379](https://github.com/kno/kInorA/pull/379) | `6a8d97b` | B + C — stored `abandoned` status and auto-close on start | 1,422 lines (`size:exception`) |
| [#380](https://github.com/kno/kInorA/pull/380) | `df2f06d` + `82652a1` | A — actionable under-24h banner and auto-close notice | 1,729 lines (`size:exception`) |
| [#381](https://github.com/kno/kInorA/pull/381) | `08dc557` | Read-only abandoned history | 438 lines (within budget) |

### PR 1 — stored status and auto-close
Add-only enum migration (`drizzle/0026_workout_session_abandoned_enum.sql`, journal `idx: 26`) with a guard test that fails in CI when a journal entry is missing; shared `apps/api/src/db/session-abandonment.ts` owning the threshold and cutoff arithmetic; two-arm retention-funnel predicate; the four guard stances; three-phase `startSession` with an in-transaction re-read under the existing user-row lock and an age-scoped auto-close `UPDATE`; `abandonSession` and `POST /workout-sessions/:id/abandon`; the auto-close notice DTO; `sessionLifecycle`/`isTerminal` on both tracker clients.

### PR 2 — actionable banner
Resume and Discard (Discard behind one confirmation), the blocking session's start date in the message, and focus handoff on web `/plan`. Three review findings from Sourcery were addressed: a nested `role="alert"` producing duplicate screen-reader announcements, and a missing in-flight guard on the mobile discard flow. A third — removing a `?? ""` fallback — was investigated and **correctly left alone**: the web-local `StartWorkoutSessionActionResult` genuinely has optional fields because it traces back to an unvalidated `res.json()` cast in `parseWorkoutSessionResponse`, so the fallback guards a real boundary.

### PR 3 — read-only history
`listCompletedSessions` renamed to `listSessionHistory` (it no longer promises completed-only), status widened to `inArray(["completed","abandoned"])`, `coalesce(completed_at, started_at)` ordering, completed-only trend pairing, and the abandoned label on web and mobile with no reopen affordance anywhere.

## Design centre

The author of #367 refused to mark the blocking session `completed` while unblocking production by hand, because it was not — it held 1 of 15 sets, and recording that falsehood would have injected a fake completion into the #353 retention funnel.

That refusal is what this change is built around. Auto-close writes `abandoned`, never `completed`, and the transition is a status update rather than a delete, so every `session_exercises` and set row survives.

What made it mechanically clean: `workout_sessions_single_active_per_user_unique` is a **partial** unique index on `(tenant_id, user_id) WHERE status = 'active'`. Writing `abandoned` drops the row out of the index and frees the slot inside the same transaction — no index change, and the single-active-session invariant is preserved rather than relaxed.

## Gates at close

Run directly, not taken from the apply phase.

| Gate | Result |
|---|---|
| `pnpm type-check` | clean, 7 workspaces |
| `pnpm -r --if-present test:coverage` | exit 0; apps/api ≥85%, apps/web ≥90% held |
| `pnpm build` | exit 0 |
| `apps/mobile && pnpm test` | 481/481 |

## The caveat — recorded plainly, not softened

Nine `apps/api` integration suites never execute. They are wrapped in `describe.skipIf(!process.env.DATABASE_URL)`, the hermetic CI job has no database, and the real-Postgres job runs a hardcoded file list that omits them. This gap predates this change; it is filed as **#382**, approved and prioritised.

`workout-session.integration.test.ts` is one of the omitted suites. **Four assertions exist but have never run anywhere:**

- concurrent double-tap on Start returns `resumed` rather than violating the partial unique index
- auto-close writes `abandoned` and never `completed`
- history ordering uses `coalesce(completed_at, started_at)`
- volume trend pairs completed-with-completed only

Those requirements are satisfied by **code inspection**, not by an executing test. **The change's central guarantee — auto-close never writes `completed` — is verified by reading one line of code. It is correct, and it remains automatically unproven until #382 lands.**

By contrast, the retention-funnel two-arm predicate is covered by `admin-stats.integration.test.ts`, which **is** on the CI list and runs on every PR and merge. It is the strongest evidence in the chain.

The verification phase attempted to convert the four unproven assertions into executed evidence by starting a local Postgres, and could not — the podman/krunkit socket on that machine is broken. CI is therefore the only realistic path to proving them.

## Corrections made during the change

Two pinned proposal decisions were disproven by later phases and carry inline `CORRECTED` blocks in `proposal.md`:

- **Decision 8 was wrong.** Widening `WorkoutSessionRecordStatus` flags nothing — both `isCompleted` derivations are plain `===` comparisons. The forcing function had to be built, not inherited. This also surfaced a **pre-existing mobile bug**: `tracker-logic.ts` computed `isComplete = status === "completed" || currentExercise === undefined`, so a fully-logged unfinished session already reported itself complete. Wrong before this change; making `abandoned` reachable forced the fix.
- **Decision 10 is closed.** Both previously unverified consumers (`getWeeklyOverview`, `getExerciseDetail`) filter `completed`-only. A consumer the original inventory missed — `findById`, which has no status filter at all — is why the tracker derivations moved into PR 1.

The issue's own diagnosis of scope A was also incorrect and was corrected in the proposal: it claimed the `conflict` value was threaded but never rendered. A localized `role="alert"` banner already rendered in all three clients. The real defects were that it was read-only text, sat in the week-board panel rather than beside the Hero CTA that triggered it, had no focus management, and never named the date.

## Follow-up work

| Issue | Status |
|---|---|
| [#378](https://github.com/kno/kInorA/issues/378) — swallowed-error audit (scope D of #367) | open, `status:needs-review` |
| [#382](https://github.com/kno/kInorA/issues/382) — nine integration suites never execute | open, **approved and prioritised** |

Two smaller items surfaced by review and deliberately not taken:

- Extract a shared `ConflictBanner` component and conflict-text helper. The derivation is triplicated across `DayDetailPanel`, `PlanStatusClient` and mobile. Legitimate refactor, not a defect.
- Validate the response shape at the `parseWorkoutSessionResponse` boundary, or narrow `StartWorkoutSessionActionResult` to required strings, so a malformed payload cannot yield an empty session id.

## Forecast accuracy — for the next change in this repo

The `tasks` phase underestimated changed lines in every PR, always through test mass, never through implementation:

| PR | Forecast | Actual | Miss |
|---|---|---|---|
| 1 | ~620 | 1,422 | 2.3× |
| 2 | ~200 | 1,729 | 8.6× |
| 3 | ~140 | 438 | 3.1× |

Non-test lines were close to estimate throughout. Under strict TDD with integration tests, test lines in this repo run roughly **1.5–1.8× the non-test lines**, not the ~1.2× the forecasts assumed. A review budget expressed as a total changed-line count will keep firing spuriously; expressed as non-test lines it would have bound correctly on all three PRs.
