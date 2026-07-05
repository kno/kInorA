# Delta for 09a-v1-workout-tracking-core

## ADDED Requirements

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

The system MUST enforce at most one active workout session per user.

#### Scenario: Existing active session reused

- GIVEN a user already has an active workout session
- WHEN they start another online workout session
- THEN no duplicate active session is created
- AND the existing active session is returned or resumed

### Requirement: Slice Boundaries

This slice MUST NOT provide analytics, statistics, offline capture, offline history, or offline sync.

#### Scenario: Deferred features absent

- GIVEN a user tracks a workout in this slice
- WHEN session or exercise surfaces render
- THEN they show live tracking context only
- AND they omit analytics and offline sync controls

## MODIFIED Requirements

### Requirement: Workout Session Recording

The system MUST allow users to start online sessions from ready plans and record sets against the snapshot. Sets MUST support reps, weight, completion status, notes, and valid RPE.
(Previously: Sessions and sets were not tied to ready-plan start or snapshots.)

#### Scenario: Complete set entry

- GIVEN a user performs an active workout session
- WHEN they submit weight, reps, RPE, completion status, and notes
- THEN the set is stored and appears in the active session

#### Scenario: Start requires ready plan

- GIVEN no ready plan is available for the selected workout
- WHEN the user starts an online workout session
- THEN no session is created

### Requirement: Live Session Tracker Surface

The tracker MUST show active exercise, planned sets, logged progress, rest/status controls, completion state, and next action.
(Previously: Tracker context omitted online scope and completion behavior.)

#### Scenario: User tracks active workout

- GIVEN a user starts a workout session from a ready plan
- WHEN the tracker renders
- THEN it shows active exercise, planned sets, logged progress, and next action

### Requirement: Exercise Execution Surface

Exercise screens MUST show session instructions, planned sets, rest context, status, and controls for safe execution, without analytics.
(Previously: Safe execution context was required, but analytics exclusion was implicit.)

#### Scenario: User views exercise details

- GIVEN a user opens an exercise during a live session
- WHEN the exercise detail surface renders
- THEN it shows instructions, planned sets or rest context, status, and controls
- AND it does not show progress analytics

### Requirement: RPE Validation

Set RPE MUST be numeric and constrained to the inclusive 0-10 range.
(Previously: Only invalid RPE rejection was specified.)

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
(Previously: Tenant scope hid other tenants, but user mismatch and 404 behavior were not explicit.)

#### Scenario: Other tenant session hidden

- GIVEN a session owned by tenant B
- WHEN a tenant A user requests it
- THEN the system returns 404-style no session data

#### Scenario: Other user session hidden

- GIVEN a session owned by another user in the same tenant
- WHEN the authenticated user requests it
- THEN the system returns 404-style no session data
