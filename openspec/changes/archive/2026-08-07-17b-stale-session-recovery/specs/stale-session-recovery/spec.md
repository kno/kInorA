# Stale Session Recovery Specification

## Purpose

A blocking `active` workout session older than 24 hours must never require production database
access to clear. Starting a new session auto-closes the stale one as `abandoned` — never
`completed` — with no data loss, a stored fact the retention funnel can read directly, and a
truthful, non-blocking notice to the user. A session started earlier the same day still gives the
user a real choice: resume it, or discard it through the same `abandoned` write path, with the
choice framed by the blocking session's actual start date. An `abandoned` session remains visible
afterward as a read-only history record — never resumable, never writable, never completable.

## Requirements

### Requirement: Auto-Close On Session Start Past Threshold

When `startSession` finds a blocking `active` session for the requesting user whose age exceeds
`ABANDONED_SESSION_THRESHOLD_HOURS` (24), the system MUST transition that session to `abandoned` in
the same transaction that creates the new session, and the start MUST then succeed via the normal
`started` (or same-plan-same-day `resumed`) branch. Below the threshold, the existing `conflict`
branch MUST be unchanged.

#### Scenario: Session older than the threshold is auto-closed and the new start succeeds

- GIVEN a user has an `active` session started more than 24 hours ago
- WHEN that user calls `startSession` for a different plan or day
- THEN the older session is transitioned to `abandoned` in the same transaction
- AND the new session is created and returned as `started`

#### Scenario: Session under the threshold still produces the existing conflict

- GIVEN a user has an `active` session started less than 24 hours ago, for a different plan or day
  than the one being requested
- WHEN that user calls `startSession`
- THEN no session is auto-closed
- AND `startSession` returns the existing `conflict` result unchanged

#### Scenario: Same-plan-same-day resume is unaffected by the threshold

- GIVEN a user has an `active` session for the same plan and day being requested, regardless of its
  age
- WHEN that user calls `startSession` for that plan and day
- THEN the existing session is resumed
- AND no auto-close transition occurs

#### Scenario: Concurrent double-tap on Start does not violate the single-active-session invariant

- GIVEN a user has a blocking `active` session older than the threshold
- WHEN two `startSession` calls for that user race concurrently
- THEN the user-row lock serializes the two calls
- AND exactly one new `active` session exists for the user afterward
- AND the stale session is transitioned to `abandoned` exactly once, not twice

### Requirement: Auto-Close Never Writes Completed

An auto-close transition MUST write `abandoned` and MUST NEVER write `completed` to the closed
session's `status`.

#### Scenario: Auto-close writes abandoned, not completed

- GIVEN a session eligible for auto-close under the threshold rule
- WHEN the auto-close transition runs
- THEN the resulting `status` value is `abandoned`
- AND the resulting `status` value is never `completed`

### Requirement: Auto-Close Preserves All Session Data

Auto-close MUST be a status update only. It MUST NEVER delete the closed session's row, its
`session_exercises` rows, or any set rows belonging to it.

#### Scenario: Logged sets survive an auto-close

- GIVEN a session with logged `session_exercises` and set rows is auto-closed
- WHEN the transition completes
- THEN the session row still exists
- AND every `session_exercises` row and every set row belonging to it still exists and is readable

### Requirement: Auto-Close Notice Names the Closed Session's Date

When a session start triggers an auto-close, the start response MUST carry enough information for
the client to tell the user that a stale session was closed on their behalf, naming that session's
start date. The user MUST see a non-blocking notice; it MUST NOT block or delay the new session
from starting.

#### Scenario: Start response signals an auto-close occurred

- GIVEN a `startSession` call that triggers an auto-close
- WHEN the response is returned
- THEN it identifies that an auto-close happened
- AND it carries the closed session's start date
- AND the new session is returned as started, not blocked pending acknowledgement of the notice

#### Scenario: No notice when no auto-close occurred

- GIVEN a `startSession` call that does not trigger an auto-close (no blocking session, or a
  same-plan-same-day resume, or an under-threshold conflict)
- WHEN the response is returned
- THEN it carries no auto-close notice

### Requirement: Abandoned Sessions Are Terminal, With One Exception for Deletion

An `abandoned` session MUST be rejected by `recordSet` and by `completeSession`. It MUST NOT be
matched by `findLatestActiveSession`. It MUST be accepted by `deleteById` and by
`deleteAllByUser`.

#### Scenario: recordSet rejects an abandoned session

- GIVEN a session with `status = 'abandoned'`
- WHEN a set is recorded against that session
- THEN the operation is rejected
- AND no set row is written

#### Scenario: completeSession rejects an abandoned session

- GIVEN a session with `status = 'abandoned'`
- WHEN a completion is attempted against that session
- THEN the operation is rejected
- AND the session's `status` remains `abandoned`

#### Scenario: findLatestActiveSession does not match an abandoned session

- GIVEN a user's only session with any "blocking" candidacy has `status = 'abandoned'`
- WHEN `findLatestActiveSession` runs for that user
- THEN it returns no session
- AND a subsequent `startSession` call for that user proceeds as if no blocking session exists

#### Scenario: deleteById accepts an abandoned session

- GIVEN a session with `status = 'abandoned'` owned by the requesting user
- WHEN `deleteById` is called for that session
- THEN the session and its dependent rows are deleted
- AND the operation is not rejected on the grounds that the session is "in progress"

#### Scenario: deleteAllByUser accepts an abandoned session in the set it deletes

- GIVEN a user has one or more sessions with `status = 'abandoned'`
- WHEN `deleteAllByUser` is called for that user
- THEN the abandoned sessions are included in the deletion
- AND the operation is not rejected on the grounds that an abandoned session is "in progress"

### Requirement: Retention Funnel Counts Each Session Exactly Once

`getRetentionFunnel` MUST count a session as abandoned if it has `status = 'abandoned'`, OR if it
has `status = 'active'` and is older than `ABANDONED_SESSION_THRESHOLD_HOURS`. These two arms MUST
be mutually exclusive by construction, so that every session in a mixed population — some rows
already transitioned to stored `abandoned`, others still `active` and aged past the threshold
because they predate this change and have not yet been touched — is counted exactly once, never
zero times and never twice.

#### Scenario: A stored-abandoned row is counted once

- GIVEN a session with `status = 'abandoned'`
- WHEN `getRetentionFunnel` runs
- THEN that session is counted in the abandoned total exactly once

#### Scenario: An untouched, aged active row is counted once

- GIVEN a session with `status = 'active'` whose age exceeds the threshold, that has never been
  touched by an auto-close or discard transition
- WHEN `getRetentionFunnel` runs
- THEN that session is counted in the abandoned total exactly once

#### Scenario: A mixed population during the transition period sums correctly

- GIVEN a population containing both stored-`abandoned` rows and untouched aged-`active` rows for
  the same or different users
- WHEN `getRetentionFunnel` runs
- THEN the abandoned total equals the count of stored-`abandoned` rows plus the count of
  untouched aged-`active` rows
- AND no session is counted in both arms

#### Scenario: A recently started active row is not counted as abandoned

- GIVEN a session with `status = 'active'` whose age is under the threshold
- WHEN `getRetentionFunnel` runs
- THEN that session is not counted in the abandoned total

### Requirement: No Backfill for Pre-Existing Active Rows

A session that already had `status = 'active'` before this change ships MUST keep that status until
its owner next starts a new session that triggers the auto-close transition or a discard. This is
expected behavior, not a data gap: the retention funnel's dual-arm count (see above) accounts for it
without any migration-time data rewrite.

#### Scenario: An old active row is untouched by deployment

- GIVEN a session with `status = 'active'` that predates this change and is older than the threshold
- WHEN this change is deployed
- THEN that session's `status` remains `active`
- AND it is only transitioned to `abandoned` the next time its owner starts a session that finds it
  as a blocking candidate, or explicitly discards it

### Requirement: Under-24h Conflict Banner Is Actionable and Named by Date

When `startSession` returns the under-threshold `conflict` result, the client MUST render a banner
that names the blocking session's start date, and MUST offer a Resume action (navigate to the
blocking session's tracker) and a Discard action. Discard MUST require one explicit confirmation
step before it takes effect. On web `/plan`, the banner MUST receive focus (or an equivalent
scroll-into-view-and-focus handoff) when it appears, rather than rendering silently in an
off-screen panel. This requirement applies to web `/plan`, web `/plan/[id]`, and mobile.

#### Scenario: Conflict banner names the blocking session's start date

- GIVEN a `conflict` result naming a blocking session
- WHEN the banner renders on web `/plan`, web `/plan/[id]`, or mobile
- THEN the banner text includes the blocking session's start date

#### Scenario: Conflict banner offers Resume and Discard actions

- GIVEN a `conflict` result naming a blocking session
- WHEN the banner renders
- THEN the banner offers a Resume action and a Discard action

#### Scenario: Discard requires one confirmation step before it takes effect

- GIVEN a rendered conflict banner with a Discard action
- WHEN the user activates Discard
- THEN the system requests one explicit confirmation before discarding
- AND the blocking session is not discarded until that confirmation is given

#### Scenario: The conflict banner receives focus on /plan

- GIVEN a `conflict` result is returned in response to a Start action on web `/plan`
- WHEN the banner renders
- THEN focus moves to the banner (or the view scrolls to bring it into view and focus it)
- AND the user is not required to manually scroll to discover that a conflict occurred

#### Scenario: Resume navigates to the blocking session's tracker

- GIVEN a rendered conflict banner with a Resume action
- WHEN the user activates Resume
- THEN the user is navigated to the blocking session's tracker
- AND the requested new session is not started

### Requirement: Discard Produces the Same Terminal State as Auto-Close

Discarding a blocking session from the conflict banner MUST transition that session to `abandoned`
through the same write path used by threshold-based auto-close: one transition, reachable by either
trigger (age, or an explicit user Discard).

#### Scenario: Discard writes the identical abandoned state

- GIVEN a user confirms Discard on a blocking under-threshold session
- WHEN the discard completes
- THEN the discarded session's `status` becomes `abandoned`
- AND its `session_exercises` and set rows are preserved exactly as an auto-closed session's would be
- AND the requested new session is then started

### Requirement: Abandoned Sessions Appear as Read-Only History

An `abandoned` session MUST appear in the user's session history alongside its logged sets. From
that history view, the system MUST offer no resume action, no set-logging action, and no completion
action for an abandoned session. This applies to web and mobile.

#### Scenario: Abandoned session is listed in history with its logged sets

- GIVEN a user has one or more sessions with `status = 'abandoned'`
- WHEN that user views their session history on web or mobile
- THEN each abandoned session appears in the list
- AND each abandoned session's logged sets are visible when it is opened

#### Scenario: History view offers no resume, log, or complete action for an abandoned session

- GIVEN an abandoned session open in the history view
- WHEN the user looks for an action on it
- THEN no resume action is offered
- AND no set-logging action is offered
- AND no completion action is offered
