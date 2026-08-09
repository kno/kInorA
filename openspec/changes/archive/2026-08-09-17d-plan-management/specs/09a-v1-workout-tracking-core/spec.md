# Delta for 09a-v1-workout-tracking-core

## MODIFIED Requirements

### Requirement: Workout Session Recording

The system MUST allow users to start online sessions from ready plans and record sets against the
snapshot. Sets MUST support reps, weight, completion status, notes, and valid RPE. `startSession`
MUST refuse to create a new session when the target plan has a non-null `archivedAt`, returning a
typed, explainable error. This refusal applies only to starting a **new** session — a session
already in progress when its plan is archived MUST continue to work: recording sets, completing,
and abandoning all continue to function unaffected.
(Previously: no archive concept existed; `startSession` only required a ready plan.)

#### Scenario: Complete set entry
- GIVEN a user performs an active workout session
- WHEN they submit weight, reps, RPE, completion status, and notes
- THEN the set is stored and appears in the active session

#### Scenario: Start requires ready plan
- GIVEN no ready plan is available for the selected workout
- WHEN the user starts an online workout session
- THEN no session is created

#### Scenario: Start refused for archived plan
- GIVEN a plan with `archivedAt` set
- WHEN a user attempts to start a new session against it
- THEN the request is refused with a typed, explainable error and no session is created

#### Scenario: In-progress session survives archiving
- GIVEN a user has an active session on a plan that is then archived
- WHEN they record a set, complete the session, or abandon it
- THEN each action succeeds exactly as if the plan had never been archived

## ADDED Requirements

### Requirement: Program Edits Never Affect An In-Progress Session

The live tracker MUST derive its state only from the session's own persisted snapshot
(`session_exercises`, `set_records`) and MUST NOT read `program_json` at any point after session
start. An edit to a plan's program while a session against it is in progress MUST NOT change that
session's exercises, sets, or targets.

#### Scenario: Editing mid-session leaves the active session untouched
- GIVEN a user has an active session snapshotted from a plan's day 2
- WHEN another edit changes that plan's day 2 program while the session is active
- THEN the active session's exercises and targets remain exactly as snapshotted at start

#### Scenario: Tracker derivation reads no program data
- GIVEN the tracker's session-state derivation logic
- WHEN it is inspected or exercised by a test
- THEN it reads only the session's own snapshot fields, never `program_json`
