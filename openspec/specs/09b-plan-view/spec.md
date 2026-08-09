# Spec: 09b-plan-view

## Scenarios

### API — list endpoint (GET /workout-plans)

SC-01: GET /workout-plans — unauthenticated → 401
SC-02: GET /workout-plans — authenticated, no plans exist for user → 200 [] (empty array, not 404)
SC-03: GET /workout-plans — authenticated, plans exist → 200 array of summaries `{ id, status, createdAt, name, daysPerWeek, completedSessions, lastTrainedAt }`, ordered newest-first (createdAt DESC). `name` is the stored plan name; for plans with `name = NULL` the value is the auto-generated default (not null, not empty string). (Previously: the summary carried only `{ id, status, createdAt, name }` — no progress fields.)
SC-04: GET /workout-plans — user+tenant scoped: response contains only the requesting user's plans within the requesting tenant
SC-05: GET /workout-plans — cross-tenant / cross-user isolation: another user's or another tenant's plans never appear in the array
SC-25: GET /workout-plans — archived plans (`archived_at IS NOT NULL`) are excluded by default; they are returned only when the show-archived parameter is set
SC-26: GET /workout-plans — the response is produced in three queries regardless of plan count (list, batched `plan_specs` read, one grouped session aggregate), never one query per plan

### API — detail endpoint (existing GET /workout-plans/:id, reused)

SC-06: GET /workout-plans/:id — unauthenticated → 401
SC-07: GET /workout-plans/:id — authenticated, owned plan with status "ready" → 200 { id, status: "ready", program: {...}, specId, archivedAt, updatedAt }. `archivedAt` drives the week view's archived indicator; `updatedAt` is the plan's current version stamp, carried so the edit form can submit it back as its expected version (see the Concurrent Edits requirement in `plan-management`). (Previously: the detail DTO carried neither `archivedAt` nor `updatedAt`.)
SC-08: GET /workout-plans/:id — authenticated, owned plan with status "generating" → 200 { id, status: "generating", program: undefined, specId }
SC-09: GET /workout-plans/:id — authenticated, owned plan with status "failed" → 200 { id, status: "failed", program: undefined, specId }
SC-10: GET /workout-plans/:id — cross-tenant / unowned plan id → 404 (existing tenant-scoped behavior)

### Web — /plan page (selector + default-latest)

SC-11: /plan page — unauthenticated → handled by AppShell auth guard (redirect to /login; no change needed)
SC-12: /plan page — user has no plans → renders empty state, no selector; CTA links to /create-plan
SC-13: /plan page — no `?planId` query param → defaults to the latest plan (first element of the newest-first list)
SC-14: /plan page — `?planId=<id>` present and owned → renders that specific plan on the same /plan route
SC-15: /plan page — `?planId=<id>` not owned / not found → detail fetch 404 → falls back to the latest plan (or empty state when the user has none); user never sees another user's plan
SC-16: /plan page — multiple plans exist → selector lists all of them, newest first, with the current selection marked
SC-17: /plan page — single plan exists → selector may be hidden (or show the one plan); the plan still renders
SC-18: /plan page — selected plan status "ready" → renders PlanStatusView (sessions + exercises visible)
SC-19: /plan page — selected plan status "generating" → redirect to /plan/[id] for the live WebSocket status view (no static snapshot rendered on /plan)
SC-20: /plan page — selected plan status "failed" → renders PlanStatusView failed state + a link to /plan/[id] (where Regenerate + live status live). No direct Regenerate button on /plan (keeps it a read-only server component)
SC-21: /plan page — list action fails (server action error) → renders a distinguishable error state, never the empty-account state shown to a user who genuinely owns zero plans. (Previously: a failed list fetch rendered the identical empty state with CTA — fail-open — so a load failure was indistinguishable from an empty account.)

### Web — selector behavior

SC-22: Selector — changing the selection navigates to `/plan?planId=<chosen-id>` (query-param navigation via router.push); the server component re-renders the selected plan on the same route
SC-23: Selector — uses `name` as the primary option label. For plans with `name = NULL` the auto-default label is shown. The selected option reflects the current `?planId` (or the latest when absent). Two plans with distinct names are visually distinguishable. (Previously: labels used created date + status only — no name field existed.)
SC-24: Web data flow — browser never calls API_BASE_URL directly: list via listPlansAction, detail via getPlanStatusAction, both server-side reading the kinora_session cookie

## Invariants

- `findAllByUser` is always tenant + user scoped: WHERE tenant_id = $1 AND user_id = $2, ORDER BY created_at DESC
- A user cannot retrieve or list another tenant's or another user's plan through these endpoints
- The default selection is the latest plan = the first element of the newest-first list (no separate /workout-plans/latest route)
- The `/plan` page never issues a direct browser fetch to the API; data flows: server component → server action → internal API_BASE_URL
- Selection changes are SSR-friendly query-param navigation (`/plan?planId=<id>`), not client→API fetches
- `PlanStatusView` is reused as-is for ready/failed; generating selections redirect to /plan/[id]
- DTO field names returned by the detail endpoint match the existing contract, extended by 17d: `{ id, status, program?, specId?, archivedAt, updatedAt? }`
- The empty state (SC-12) is a non-error UX outcome: page returns 200, no redirect; the selector is absent when the user has zero plans. A failed list fetch (SC-21) is a distinct, distinguishable error state — not the empty state

## Requirements

This spec predates the Requirement/Scenario form used elsewhere; the scenarios above remain the
enumerated acceptance list, and the requirements below are the normative RFC 2119 statements added
by `17d-plan-management`.

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
