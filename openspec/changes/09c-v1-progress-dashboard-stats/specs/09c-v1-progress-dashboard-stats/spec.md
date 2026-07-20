## MODIFIED Requirements

### Requirement: Dashboard Progress Summary

The dashboard MUST summarize current training progress using available workout and history data, scoped to web only. It MUST surface a training streak (consecutive calendar days with a completed workout session) and weekly progress (completed sessions vs. planned sessions in the current week) as the dashboard's adherence indicator. Calendar day and week boundaries for the streak and weekly progress MUST use the same single fixed timezone as the rest of this change (UTC for v1). All queries backing this surface MUST be scoped by (tenantId, userId).
(Previously: plan-week/adherence definition tied to plan-week; adherence lived on the Statistics surface.)

#### Scenario: User sees today's training context

- GIVEN a user has an active plan and workout history
- WHEN they open the dashboard
- THEN they see today's workout context, a streak indicator (consecutive training days), a weekly progress indicator (completed sessions / planned sessions this week), recent progress, and relevant quick actions

#### Scenario: Empty dashboard explains next action

- GIVEN a user has no workout history yet
- WHEN they open the dashboard
- THEN the dashboard shows an empty state that guides them toward creating a plan or starting a workout

#### Scenario: Streak counts consecutive training days

- GIVEN a user has completed workout sessions on consecutive calendar days ending today or yesterday
- WHEN they open the dashboard
- THEN the streak shows the number of consecutive calendar days with at least one completed session, and a gap day (a calendar day with no completed session) resets the streak

#### Scenario: Weekly progress does not misreport completion

- GIVEN a user is mid-way through the current week with only some sessions completed
- WHEN they open the dashboard
- THEN weekly progress reports completed sessions against the planned sessions for the current week (X/Y), without inflating completed counts for sessions not yet logged

### Requirement: Statistics Surface

The statistics surface MUST present progress metrics derived from completed workout sessions, scoped to web only. For the selected period it MUST present KPIs — total volume (kg), session count, total training time, and personal-record (PR) count — each with a delta vs. the previous period; a volume trend (current vs. previous period); muscle-group distribution across the 10 primary muscle groups; and personal records. When the previous period has no data (zero sessions/volume), each KPI delta MUST be null ("new" / no comparison), never infinity, NaN, or a divide-by-zero error. Metrics MUST degrade gracefully when underlying data is sparse or absent, rather than erroring. The statistics surface MUST NOT require an adherence KPI (adherence is a dashboard concern). All queries backing this surface MUST be scoped by (tenantId, userId).
(Previously: unscoped "adherence" KPI required on statistics; no period-delta / volume-trend definition.)

#### Scenario: User reviews training analytics

- GIVEN a user has completed workouts
- WHEN they open statistics for a period (week/month/year)
- THEN they see the KPIs (total volume, session count, total time, PR count) each with a delta vs. the previous period, a volume trend for the current vs. previous period, and personal records summarized from their session history

#### Scenario: Muscle-group distribution over the 10 primary groups

- GIVEN a user has completed sessions with exercises mapped to muscle groups
- WHEN they open statistics
- THEN the muscle-group distribution reflects relative volume/frequency across the 10 primary groups (chest, back, shoulders, biceps, triceps, core, glutes, quads, hamstrings, calves) using only data available; the UI MAY present these grouped into coarser display buckets, but the underlying distribution is computed over the 10 primary groups

#### Scenario: Exercise without a muscle-group mapping does not break distribution

- GIVEN a completed session includes at least one exercise with no muscle-group mapping
- WHEN the user opens statistics
- THEN the muscle-group distribution renders using only mapped exercises, the unmapped exercise contributes to other metrics (volume, trends, PRs) unaffected, and no error is shown

#### Scenario: Personal records surface estimated 1RM from sets with logged weight and reps

- GIVEN a user has completed sessions for an exercise with at least one set that is completed and has both a logged weight (> 0) and logged reps (> 0)
- WHEN they open statistics
- THEN each personal record shows the exercise's estimated one-rep max (estimated 1RM), the date it was achieved, and a recent trend, computed only from eligible sets (completed, weight > 0, reps > 0)

#### Scenario: Bodyweight and no-weight sets are excluded from 1RM PRs

- GIVEN an exercise only has bodyweight, no-weight/assisted, or null-reps sets logged
- WHEN the user opens statistics
- THEN no estimated-1RM personal record is shown for that exercise (it is omitted, not shown as zero), while its sets still contribute to volume, session count, and trends where applicable

#### Scenario: KPI delta is null when there is no previous period

- GIVEN a user has data in the selected period but no completed sessions in the previous period
- WHEN they open statistics
- THEN each KPI shows its current value with a null "new" delta (no percentage, no up/down arrow), never infinity, NaN, or an error

#### Scenario: Sparse or absent data degrades gracefully

- GIVEN a user has zero or very few completed sessions
- WHEN they open statistics
- THEN each metric section (KPIs, volume trend, distribution, PRs) independently shows an empty/insufficient-data state instead of failing or hiding the whole surface

### Requirement: Weekly Plan and Progress Overview

The weekly plan surface MUST present a 7-day calendar week (Monday–Sunday) with previous/next week navigation and a week label (calendar dates), scoped to web only. For each day in the displayed week, the surface MUST show exactly one status: done (a session was completed that day), active (today's in-progress or scheduled day), rest (a planned rest day), or soon (a future planned training day). Calendar day and week boundaries MUST be computed in a single fixed timezone (UTC for v1). A day's **done** status MUST be driven by real completed-session dates (`workout_sessions.completedAt`) bucketed into the calendar week, counted regardless of which plan version produced the session. The planned overlay (soon/rest/active) is derived from the current plan's training-day count using a deterministic placement; because the plan model has no calendar-weekday anchor, this placement is a display convention and MUST NOT override the date-driven done status. The four statuses MUST be exhaustive: a past planned training day with no completed session (a skipped day) MUST render as **rest**, not as a separate "missed" status, so the board never accuses the user of a miss. All queries backing this surface MUST be scoped by (tenantId, userId).
(Previously: plan-week semantics anchored to plan creation, with status states planned/completed/missed/upcoming.)

#### Scenario: User reviews the week

- GIVEN a user has a generated plan and logged sessions
- WHEN they open the weekly plan overview
- THEN they see a Monday–Sunday board where each day shows exactly one of: done (a session was completed that day), active (the current day), rest (a planned rest day), or soon (a future planned training day)

#### Scenario: User navigates between weeks

- GIVEN a user is viewing the current week
- WHEN they navigate to the previous or next week
- THEN the board updates to that calendar week (with an updated week label) and recomputes each day's status from the sessions and plan for that week

#### Scenario: No sessions logged yet in the week

- GIVEN a user has a generated plan but has not logged any sessions in the displayed week
- WHEN they open the weekly plan overview
- THEN training days that have not yet occurred show as soon, planned rest days show as rest, and today shows as active, with no false done states

#### Scenario: Navigating to a week that predates the plan or account

- GIVEN a user navigates to a calendar week before their current plan (or account) existed
- WHEN the board renders that week
- THEN every day shows as rest except any day with a real completed session that week (which shows done from its actual completed-session date), with no fabricated soon/active/planned statuses and no error

#### Scenario: Completed session counts regardless of plan version

- GIVEN a user completed a session in the displayed calendar week that was logged against an older or since-regenerated plan
- WHEN the board renders that week
- THEN that day still shows done, because completion is bucketed by calendar date and is not filtered by which plan version produced the session

### Requirement: Exercise Detail Progress References

Exercise detail views SHOULD reference recent history for the selected exercise when available, read-only, scoped to web only. This reference MUST NOT replace or duplicate the live workout-tracking flow. All queries backing this surface MUST be scoped by (tenantId, userId); in particular `getExerciseDetail`, which looks up by free-text exercise `title`, MUST NOT allow one user to read another user's rows via a crafted title.
(Previously: no explicit read-only/non-duplication constraint and no web-only scope.)

#### Scenario: User views exercise history context

- GIVEN a user opens an exercise detail screen for an exercise they have performed before
- WHEN workout history exists for that exercise
- THEN the screen shows recent performance context (e.g. recent sets/reps/weight) without replacing the live session tracking flow

#### Scenario: No history for the exercise

- GIVEN a user opens an exercise detail screen for an exercise they have never performed
- WHEN no workout history exists for that exercise
- THEN the screen omits the performance reference section rather than showing an error or misleading placeholder data
