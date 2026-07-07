# 93c-session-day-attribution Specification

## Purpose

Record which training day a workout session represents (`day SMALLINT` on
`workout_sessions`) and define the 3-branch semantics for `startSession` scoped to
`(planId, day)`. Preserves the single-active-per-user invariant enforced by the
`singleActivePerUser` partial unique index.

## Requirements

### Requirement: Session Records Training Day

Every new `workout_sessions` row MUST store the `day` value supplied by the caller.
Existing rows (migrated) have `day = NULL` and MUST be treated as non-matching in
scoped lookups.

#### Scenario: New session stores day

- GIVEN a user starts a session for plan `abc`, day `3`
- WHEN the session row is created
- THEN `workout_sessions.day = 3` for that row

#### Scenario: Legacy null-day session is non-matching

- GIVEN a session row has `day = NULL`
- WHEN a scoped lookup for `(planId, day = 2)` runs
- THEN the null-day session is NOT treated as a match

### Requirement: startSession 3-Branch Semantics

`startSession` MUST implement exactly three mutually exclusive branches based on the
current active session state for the user:

**Branch A — Resume**: no active session, or the active session matches `(planId, day)` → resume/return it.
**Branch B — Conflict**: an active session exists for a DIFFERENT `(planId, day)` → surface a conflict message
containing the plan name and day of the blocking session; do NOT create a new session; do NOT return the
wrong session.
**Branch C — Create**: no active session exists → create a new session for `(planId, day)`.

#### Scenario: Branch A — resume matching active session

- GIVEN a user has an active session for plan `abc`, day `2`
- WHEN they call `startSession` with `planId = "abc"`, `day = 2`
- THEN the existing active session is returned (resumed), no new row created

#### Scenario: Branch B — conflict on mismatched (planId, day)

- GIVEN a user has an active session for plan `abc`, day `2`
- WHEN they call `startSession` with `planId = "abc"`, `day = 3`
- THEN the call returns a conflict result (not the active session, not a new session)
- AND the conflict message identifies the blocking plan name and day

#### Scenario: Branch B — conflict on different plan

- GIVEN a user has an active session for plan `abc`, day `1`
- WHEN they call `startSession` with `planId = "xyz"`, `day = 1`
- THEN the call returns a conflict result referencing plan `abc`, day `1`

#### Scenario: Branch C — create when no active session

- GIVEN a user has no active session
- WHEN they call `startSession` with `planId = "abc"`, `day = 1`
- THEN a new session row is created with `day = 1`, status `active`

### Requirement: Single-Active-Per-User Invariant Preserved

The system MUST NOT allow more than one active session per user at any time. The
`singleActivePerUser` partial unique index is the hard DB-level backstop. Branch B
MUST surface the conflict BEFORE attempting any insert; no second active session is
ever created.

#### Scenario: DB constraint never reached via conflict surfacing

- GIVEN a user already has an active session
- WHEN `startSession` is called with a mismatched `(planId, day)`
- THEN Branch B fires and no INSERT is attempted
- AND the DB `singleActivePerUser` unique constraint is never violated

### Requirement: Multi-Week Per-Day History

Repeating a training day in a later real-world week MUST produce a new session row with
its own `startedAt` timestamp. Per-day history MUST NOT be collapsed by `(planId, day)`
alone — every occurrence over time is a distinct dated record.

#### Scenario: Week 1 and Week 2 sessions for same day are distinct rows

- GIVEN a user completed a session for plan `abc`, day `1` in week 1
- WHEN they start a new session for plan `abc`, day `1` in week 2 (no active session blocking)
- THEN a new session row is created with a new `startedAt` value
- AND both rows are present in history (two distinct dated records)

#### Scenario: Per-day history returns all occurrences

- GIVEN three sessions exist for `(planId = "abc", day = 1)` on different dates
- WHEN per-day history is queried for `(planId = "abc", day = 1)`
- THEN all three records are returned, each with its own `startedAt` date

### Requirement: Route Layer Compliance

All new server-side data access for session start and day lookup MUST go through server
actions or injected repository ports. No route or client component MUST import the DB
layer directly (#85 `routes-no-db-layer` rule).

#### Scenario: Session start does not import db from route

- GIVEN a client triggers the "Empezar sesión" CTA
- WHEN the request is processed
- THEN only a server action / API route is called; no direct DB import occurs in any route or client file
