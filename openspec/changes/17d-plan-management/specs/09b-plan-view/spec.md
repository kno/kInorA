# Delta for 09b-plan-view

## MODIFIED Requirements

### Requirement: List Endpoint Returns Progress Fields And Excludes Archived Plans

`GET /workout-plans` MUST return, per plan, in addition to `{ id, status, createdAt, name }`:
`daysPerWeek` (read from the plan's `plan_specs.spec_json`), `completedSessions` (count of
`workout_sessions` with `status = 'completed'` for that plan), and `lastTrainedAt`
(`MAX(COALESCE(completed_at, started_at))` across that plan's sessions, or null if none). The
endpoint MUST default to `WHERE archived_at IS NULL` and MUST accept a parameter to include
archived plans. The endpoint MUST still be produced in three total queries (list, batched
`plan_specs` read, one grouped session aggregate) — never per-plan.
(Previously: returned only `{ id, status, createdAt, name }`, unauthenticated → 401, empty →
`200 []`, tenant+user scoped, cross-tenant/cross-user isolated, ordered newest-first.)

#### Scenario: Unauthenticated request rejected
- GIVEN no valid session
- WHEN `GET /workout-plans` is called
- THEN the response is 401

#### Scenario: No plans exist
- GIVEN an authenticated user with zero plans
- WHEN they call `GET /workout-plans`
- THEN the response is `200 []`

#### Scenario: Response includes progress fields
- GIVEN an authenticated user with a ready plan and completed sessions
- WHEN they call `GET /workout-plans`
- THEN each entry includes `daysPerWeek`, `completedSessions`, and `lastTrainedAt`

#### Scenario: Archived plans excluded by default
- GIVEN a user has one archived and one active plan
- WHEN they call `GET /workout-plans` without the show-archived parameter
- THEN only the active plan is returned

#### Scenario: Archived plans included on request
- GIVEN a user has an archived plan
- WHEN they call `GET /workout-plans` with the show-archived parameter set
- THEN the archived plan is included in the response

#### Scenario: Cross-tenant / cross-user isolation
- GIVEN plans owned by another user or tenant
- WHEN the authenticated user calls `GET /workout-plans`
- THEN those plans never appear in the response

### Requirement: /plan Page Distinguishes A Load Failure From An Empty List

A failed `listPlansAction()` call on the `/plan` page MUST render a distinguishable error state,
never the same empty-account UI shown to a user who genuinely owns zero plans. `/plan` MUST
continue resolving `?planId=X` deep links and its single-plan short-circuit unchanged.
(Previously: a failed list fetch rendered the identical empty-account state — `listResult.kind
=== "ok" ? listResult.plans : []` swallowed the failure, per `plan/page.tsx:36`.)

#### Scenario: Genuinely empty account
- GIVEN an authenticated user with zero plans
- WHEN `/plan` renders
- THEN it shows the empty state with a create-plan CTA

#### Scenario: Failed fetch is not rendered as empty
- GIVEN `listPlansAction()` fails for a user who does have plans
- WHEN `/plan` renders
- THEN it shows a distinguishable error state, not the empty-account state

#### Scenario: Deep link still resolves
- GIVEN a valid `?planId=<id>` for a plan the user owns
- WHEN `/plan` renders
- THEN that plan renders on the same route, unaffected by this change
