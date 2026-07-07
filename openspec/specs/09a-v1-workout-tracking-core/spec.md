# 09a-v1-workout-tracking-core Specification

## Purpose

Provide live workout/session tracking, exercise execution surfaces, set records, RPE validation, and notes before offline sync is added.

## Dependencies

- `01c-v1-multi-tenant-schema`
- `05b-v1-security-tenant-validation`

## Requirements

### Requirement: Workout Session Recording

The system MUST allow users to start online sessions from ready plans and record sets against the snapshot. Sets MUST support reps, weight, completion status, notes, and valid RPE.

#### Scenario: Complete set entry

- GIVEN a user performs an active workout session
- WHEN they submit weight, reps, RPE, completion status, and notes
- THEN the set is stored and appears in the active session

#### Scenario: Start requires ready plan

- GIVEN no ready plan is available for the selected workout
- WHEN the user starts an online workout session
- THEN no session is created

### Requirement: Planned Exercise Snapshot

Starting from a ready plan MUST snapshot exercises, set targets, instructions, and rest context so later plan edits do not change that session.

#### Scenario: Start preserves plan data

- GIVEN an authenticated user has a ready workout plan
- WHEN they start an online workout session
- THEN the session contains start-time plan data
- AND later plan changes do not alter it

### Requirement: Session Completion

The owning user MUST complete an active workout session, and completed sessions MUST expose completed state.

#### Scenario: Complete active session

- GIVEN a user owns an active workout session
- WHEN they complete the session
- THEN the session state is completed
- AND active set-recording actions are unavailable

### Requirement: Single Active Session

The system MUST enforce at most one active workout session per user. The
`singleActivePerUser` partial unique index is the DB-level backstop. Resume semantics
are `(planId, day)`-scoped:

- If the current active session matches the requested `(planId, day)` → resume it (return the existing session).
- If the current active session belongs to a DIFFERENT `(planId, day)` → surface a
  conflict message containing the blocking plan name and day; do NOT silently return the
  wrong session; do NOT attempt to create a second active session.
- If no active session exists → create a new one.

(Previously: any existing active session was returned or resumed regardless of planId or day — no conflict surfacing, no day attribution.)

#### Scenario: Resume same (planId, day) — no duplicate created

- GIVEN a user already has an active session for plan `abc`, day `2`
- WHEN they start another session for plan `abc`, day `2`
- THEN no new session row is created
- AND the existing active session is returned

#### Scenario: Conflict surfaced for mismatched (planId, day)

- GIVEN a user has an active session for plan `abc`, day `2`
- WHEN they start a session for plan `abc`, day `3`
- THEN the system surfaces a conflict message identifying plan `abc` and day `2`
- AND no new active session is created

#### Scenario: Conflict surfaced for different plan

- GIVEN a user has an active session for plan `abc`, day `1`
- WHEN they start a session for plan `xyz`, day `1`
- THEN the system surfaces a conflict message identifying plan `abc` and day `1`
- AND the `singleActivePerUser` DB constraint is never violated

#### Scenario: New session created when none active

- GIVEN a user has no active session
- WHEN they start a session for plan `abc`, day `1`
- THEN a new session row is created with `status = active` and `day = 1`

### Requirement: Session Day Attribution

Every session started from a `(planId, day)` context MUST record the `day` value.
Sessions created before this change have `day = NULL` and MUST be treated as
non-matching in scoped lookups.

#### Scenario: Session row stores day

- GIVEN a user starts a session for plan `abc`, day `4`
- WHEN the session is created
- THEN `workout_sessions.day = 4`

#### Scenario: Null-day session is non-matching in scoped lookup

- GIVEN a legacy session with `day = NULL` is active
- WHEN a scoped lookup for `(planId, day = 2)` runs
- THEN the null-day session is NOT returned as a match — Branch B (conflict) fires

### Requirement: Multi-Week Per-Day History

Repeating a training day in a later real-world week MUST produce a new session row with
its own `startedAt` timestamp. Per-day history MUST NOT be collapsed to the latest row
by `(planId, day)` alone.

#### Scenario: Week 2 repetition creates a new session row

- GIVEN a completed session exists for `(planId = "abc", day = 1)` from week 1
- WHEN the user starts a new session for `(planId = "abc", day = 1)` in week 2
- THEN a new session row is created with a distinct `startedAt`
- AND both rows appear in per-day history

#### Scenario: Per-day history lists all occurrences

- GIVEN three sessions for `(planId = "abc", day = 1)` exist on different dates
- WHEN per-day history is queried
- THEN all three records are returned, ordered by date

### Requirement: Live Session Tracker Surface

The tracker MUST show active exercise, planned sets, logged progress, rest/status controls, completion state, and next action.

#### Scenario: User tracks an active workout

- GIVEN a user starts a workout session from a ready plan
- WHEN the tracker renders
- THEN it shows active exercise, planned sets, logged progress, and next action

### Requirement: Exercise Execution Surface

Exercise screens MUST show session instructions, planned sets, rest context, status, and controls for safe execution, without analytics.

#### Scenario: User views current exercise details

- GIVEN a user opens an exercise during a live session
- WHEN the exercise detail surface renders
- THEN it shows instructions, planned sets or rest context, status, and controls
- AND it does not show progress analytics

### Requirement: RPE Validation

Set RPE MUST be numeric and constrained to the inclusive 0-10 range.

#### Scenario: Valid RPE accepted

- GIVEN a user records RPE 0, 5, or 10
- WHEN they submit the set
- THEN the set is stored without an RPE validation error

#### Scenario: Invalid RPE rejected

- GIVEN a user enters RPE below 0 or above 10
- WHEN they submit the set
- THEN the system rejects the input with a validation error

### Requirement: Tenant-Scoped Session Access

Workout sessions MUST only be visible to the owning tenant and user. Tenant or user mismatches MUST return 404-style no session data.

#### Scenario: Other tenant session hidden

- GIVEN a session owned by tenant B
- WHEN a tenant A user requests it
- THEN the system returns 404-style no session data

#### Scenario: Other user session hidden

- GIVEN a session owned by another user in the same tenant
- WHEN the authenticated user requests it
- THEN the system returns 404-style no session data

### Requirement: Slice Boundaries

This slice MUST NOT provide analytics, statistics, offline capture, offline history, or offline sync.

#### Scenario: Deferred features absent

- GIVEN a user tracks a workout in this slice
- WHEN session or exercise surfaces render
- THEN they show live tracking context only
- AND they omit analytics and offline sync controls
