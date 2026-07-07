# Delta for 09a-v1-workout-tracking-core

## MODIFIED Requirements

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

## ADDED Requirements

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
