# plan-management Specification

## Purpose

Let a user see every plan they have ever generated, tell them apart by progress, retire the ones
they are done with without losing a single session record, and correct a stored program without
regenerating it from scratch.

## Dependencies

- `09b-plan-view` (the `/plan` route and list endpoint this extends)
- `09a-v1-workout-tracking-core` (`startSession`, the tracker snapshot)
- `06-v1-mobile-foundation` (the mobile shell this adds a screen to)

## Requirements

### Requirement: Plans List Surface

The system MUST provide a `/plans` route, reachable from a new nav entry on web and mobile, listing
every non-archived plan owned by the authenticated user with: name, status, `createdAt`, days per
week, completed session count, and last-trained date. The list MUST be produced in three queries
regardless of plan count (one page query, one batched `plan_specs` read, one grouped aggregate over
`workout_sessions`) — never a per-plan query.

#### Scenario: List shows progress fields
- GIVEN a user has a ready plan with completed sessions
- WHEN they open Plans
- THEN each plan shows its days per week, completed session count, and last-trained date

#### Scenario: No per-plan query
- GIVEN a user has ten plans
- WHEN the list renders
- THEN exactly three database queries execute, none of them scoped to a single plan

### Requirement: Plans List Distinguishes A Load Failure From An Empty List

A failed fetch of the plans list MUST render a distinguishable error state, never the same UI shown
to a user who genuinely owns zero plans.

#### Scenario: Fetch failure is not rendered as "no plans"
- GIVEN the plans-list fetch fails
- WHEN the `/plans` page renders
- THEN it shows an error state, not the empty-account state

### Requirement: No Delete Route For Plans, Nor For Anything That Cascades Into Them

The system MUST NOT expose a `DELETE` route for `workout_plans`, nor for `plan_specs` or any other
resource whose deletion cascades into `workout_plans`, now or in a later change. The cascade chain is
`plan_specs.id` (`ON DELETE CASCADE` on `workout_plans.plan_spec_id`) → `workout_plans.id`
(`ON DELETE CASCADE` on `workout_sessions.workout_plan_id`) → `workout_sessions` → `session_exercises`
→ `set_records`. A `DELETE` anywhere on that chain destroys training history and every statistic
derived from it, exactly as a direct `DELETE` on `workout_plans` would — the reason is stated here so a
later reader does not reintroduce the hole by adding a route that is technically outside
`/workout-plans*` but cascades into it regardless.

> **Judgment Day finding 2 — corrected (CRITICAL, single judge, orchestrator-verified).** This
> requirement previously named only `workout_plans`, and its guard test (`design.md`) matched only
> `/workout-plans*` routes. But `workout_plans.plan_spec_id` → `plan_specs.id` is `ON DELETE CASCADE`
> (`schema.ts:659-661`), so a future `DELETE /plan-specs/:id` would destroy every plan for that spec
> and all associated training history while fully complying with the letter of the original wording,
> and would pass the original guard because it never touches `/workout-plans*`. No such route exists
> today — the gap was latent, not exploited. Widened above to name `plan_specs` and state the cascade
> chain explicitly.

#### Scenario: No delete route exists on workout_plans
- GIVEN the route table for plans
- WHEN it is inspected
- THEN it contains no `DELETE` method for any plan resource

#### Scenario: No delete route exists on plan_specs either
- GIVEN the route table for plan specs
- WHEN it is inspected
- THEN it contains no `DELETE` method, because `plan_specs` deletion cascades into `workout_plans`

### Requirement: Archive Toggles Visibility Without Losing History

A plan MUST be archivable via a nullable `archivedAt` timestamp, independent of `workoutPlanStatusEnum`.
Archived plans MUST be excluded from the default list, appearing only when an explicit show-archived
affordance is active. Archiving or unarchiving a plan MUST NOT delete, modify, or orphan any
`workout_sessions`, `session_exercises`, or `set_records` row.

> **Judgment Day finding 3 — corrected.** This requirement previously said archived plans are
> "reachable only through an explicit show-archived affordance," which read as a URL-reachability rule
> and contradicted the pinned decision that `/plan`'s `?planId=X` deep links keep working unchanged
> for every plan, archived or not. Archiving controls **list visibility, not URL reachability** — the
> wording above now says exactly that. See the new requirement below for what a direct visit to an
> archived plan's week view must show.

#### Scenario: Archiving hides a plan by default
- GIVEN a ready plan
- WHEN the user archives it
- THEN it disappears from the default list and appears only when show-archived is active

#### Scenario: Archiving preserves every session record
- GIVEN a plan with completed sessions
- WHEN it is archived
- THEN the session count for that plan is unchanged before and after

#### Scenario: A generating or failed plan can be archived
- GIVEN a plan with status `generating` or `failed`
- WHEN the user archives it
- THEN the archive succeeds independent of its status

### Requirement: An Archived Plan's Week View Indicates It Is Archived

Archiving controls list visibility, not URL reachability: an archived plan remains reachable through
its direct `/plan?planId=X` deep link, per the pinned decision that `/plan`'s selector and deep links
are unaffected by this change. When a user reaches an archived plan's week view — by deep link or by
the show-archived affordance — the view MUST visibly indicate that the plan is archived.

#### Scenario: Direct link to an archived plan still resolves, and says so
- GIVEN a plan has been archived
- WHEN a user visits its week view via `/plan?planId=X`
- THEN the week view renders normally AND visibly indicates the plan is archived

### Requirement: Archive Is Reversible

An archived plan MUST be unarchivable from the UI, restoring it to the default list with identical
behavior to before archiving.

#### Scenario: Unarchive restores default visibility
- GIVEN an archived plan
- WHEN the user unarchives it
- THEN it reappears in the default list and behaves exactly as before archiving

### Requirement: Editing The Program

The system MUST let a user edit a plan's `program_json` (days, exercises, sets) through a
server-validated write path. The submitted program MUST be validated against `WorkoutProgramSchema`.
`catalogId` and muscle group MUST be resolved server-side after parsing and MUST NOT be accepted
from the client under any submitted value.

#### Scenario: Valid edit persists
- GIVEN a user submits a program edit with valid days, exercises, and sets
- WHEN it is saved
- THEN the stored `program_json` reflects the edit

#### Scenario: Client-supplied catalogId is discarded
- GIVEN a user submits a program edit including a `catalogId` value
- WHEN the edit is saved
- THEN the persisted exercise's `catalogId` is the server-resolved value, never the submitted one

#### Scenario: Invalid program is rejected
- GIVEN a submitted program fails `WorkoutProgramSchema` validation
- WHEN the edit is saved
- THEN the write is rejected and the stored program is unchanged

### Requirement: Editing Is Restricted To Ready Plans

The system MUST reject a program edit against a plan whose status is not `ready`. `program_json` is
`NULL` until `markReady` persists it, so a `generating` or `failed` plan has no program for the edit
to act on.

#### Scenario: Editing a generating plan is rejected
- GIVEN a plan with status `generating`
- WHEN a user submits a program edit for it
- THEN the write is rejected as not-ready and the plan is unchanged

#### Scenario: Editing a failed plan is rejected
- GIVEN a plan with status `failed`
- WHEN a user submits a program edit for it
- THEN the write is rejected as not-ready and the plan is unchanged

#### Scenario: Editing a ready plan is allowed
- GIVEN a plan with status `ready`
- WHEN a user submits a valid program edit for it
- THEN the write succeeds

### Requirement: Concurrent Edits Are Detected, Not Silently Overwritten

A program edit MUST include the `updatedAt` timestamp of the plan version the editor loaded. The
system MUST reject the write with a distinguishable conflict outcome, rather than overwriting
silently, when the plan's current `updatedAt` no longer matches the submitted value. The rejected
editor MUST be told the write did not apply, distinctly from every other rejection reason (invalid
program, plan not ready, plan not found).

#### Scenario: Stale edit is rejected as a conflict
- GIVEN a plan was last updated at time T1
- AND a user loaded the plan's edit form at T1 and is still editing
- WHEN another edit updates the same plan, changing its `updatedAt` to T2
- AND the first user then submits their edit carrying the stale T1 timestamp
- THEN the write is rejected with a distinguishable conflict outcome and the plan's stored program
  remains the one written at T2

#### Scenario: Matching version succeeds
- GIVEN a plan's current `updatedAt` is T1
- WHEN a user submits an edit carrying T1 as the expected version
- THEN the write succeeds and the plan's `updatedAt` advances past T1

#### Scenario: The losing writer is told, not silently discarded
- GIVEN two edits race against the same plan
- WHEN the second write to reach the server is rejected as a conflict
- THEN the response distinguishes the conflict from a validation error, a not-ready state, and a
  not-found plan, so the client can tell that specific user their edit did not save

### Requirement: An Edited Program Keeps At Least One Session And No Dangling Day

An edit MUST NOT be saved if it would leave the program with zero sessions. If an edit removes a
day, no UI surface MUST subsequently offer that day for starting, and a request to start a session
for a day no longer present in the program MUST return a distinguishable "day not in this plan"
outcome rather than an unhandled error.

#### Scenario: Zero-session edit is rejected
- GIVEN a user submits an edit that removes every session/day
- WHEN they save it
- THEN the save is rejected and the previous program is retained

#### Scenario: Starting a removed day fails distinguishably
- GIVEN an edit removed day 4 from a plan
- WHEN a start-session request targets day 4
- THEN the system returns a distinguishable "day not in this plan" error, not a raw unhandled 404

### Requirement: The Next Session After An Edit Uses The Edited Program

A `startSession` call made after a program edit MUST snapshot the edited program, not a
previously cached or stale version.

#### Scenario: Next start reflects the edit
- GIVEN a plan's day 2 is edited to a different exercise
- WHEN a session for day 2 is started afterward
- THEN the session snapshot contains the edited exercise

### Requirement: Mobile List And Archive Parity

The mobile app MUST provide a plans-list screen and archive/unarchive actions with the same
semantics, fields, and default-hidden-archived behavior as web. Editing the program is out of scope
for mobile in this change.

#### Scenario: Mobile list matches web semantics
- GIVEN a user archives a plan from mobile
- WHEN they view the web plans list
- THEN the plan is hidden by default on both platforms

#### Scenario: Mobile has no edit surface
- GIVEN a user on mobile viewing a plan
- WHEN they look for a way to edit its program
- THEN no such control exists in this change
