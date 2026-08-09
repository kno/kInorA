# Archive Report — 17d-plan-management

**Archived**: 2026-08-09
**Status**: COMPLETE, MERGED AND DEPLOYED
**Gates re-run at archive time**: PASS (2026-08-09)

## Change Summary

17d gave the user ownership of *all* their plans rather than the single one `/plan` happened to
resolve. It added a `/plans` list surface showing real progress per plan, an archive/unarchive path
that retires a plan without destroying a single session record, mobile parity for list and archive,
and — last, and largest — a server-validated write path over a stored `program_json` so a slightly
wrong generated program can be corrected instead of regenerated from scratch. Four chained PRs
(#401, #403, #407, #408) delivered it across API, web, contracts and mobile.

**GitHub Issue**: [kno/kInorA#399](https://github.com/kno/kInorA/issues/399)

## Scope and Outcomes

### In Scope — Delivered

**A: Plans List** (PR #401)
- New `/plans` route and nav entry (`SidebarNav.NAV_ITEMS`, `MobileNav` tabs, `appNav.plans` in both
  i18n catalogs)
- `GET /workout-plans` extended with `daysPerWeek`, `completedSessions`, `lastTrainedAt`
- Three queries for the whole page regardless of plan count — list, batched `plan_specs` read,
  one `GROUP BY` over `workout_sessions` — following `listSessionHistory`'s shape. A test asserts
  no per-plan query
- The `plan/page.tsx:36` swallowed-error fix rode along: a failed `listPlansAction()` now renders a
  distinguishable error state instead of the empty-account state

**B: Archive** (PR #403)
- Nullable `archived_at` column on `workout_plans` (migration `0029_workout_plan_archived_at`,
  journal `idx: 29`)
- `POST /workout-plans/:id/archive` and `/unarchive`, idempotent by construction
  (`COALESCE(archived_at, now())`), tenant + user scoped, 0 rows → 404 with no IDOR leak
- `findAllByUser` and the progress query default to `archived_at IS NULL`, with `?includeArchived=1`
  as the show-archived opt-in
- `startSession` refuses to start a **new** session against an archived plan with a typed error; a
  session already in progress is entirely unaffected
- `archivedAt` threaded into the `GET /workout-plans/:id` DTO to drive the week view's archived
  indicator

**C: Mobile List and Archive Parity** (PR #407)
- Greenfield plans screen, nav entry, and API client methods — the first plans-list concept on
  mobile, which previously resolved exactly one "current plan" from the dashboard summary
- Same fields, same default-hidden-archived semantics as web
- Editing the program is deliberately absent on mobile in this change

**D: Edit the Program** (PR #408)
- `PUT /workout-plans/:id/program` — full `WorkoutProgramSchema` validation, `catalogId` and muscle
  group resolved server-side after parsing and never accepted from the client
- Restricted to `ready` plans (`program_json` is `NULL` until `markReady` writes it)
- Optimistic concurrency on `updatedAt`, with a conflict outcome distinguishable from a validation
  error, a not-ready state, and a not-found plan
- Zero-session edits rejected; a start against a day the edit removed returns
  `404 { error: "day_not_in_plan", availableDays: [...] }` rather than a bare unhandled 404
- End-to-end integration proof that the next `startSession` after an edit snapshots the edited
  program, and that an edit made while a session is active leaves that session byte-identical
- `planEdit.*` keys added to both i18n catalogs

### Out of Scope — Preserved

- No `DELETE` route for plans — and, after Judgment Day finding 2, none for `plan_specs` either
- No editing of the program on mobile (follow-up)
- No editing of a plan's `PlanSpec` (that implies regeneration, which already exists)
- No change to `workoutPlanStatusEnum`; archive stayed orthogonal to the generation lifecycle
- No change to `WorkoutProgramSchema`, and specifically no `catalogId` added to it
- `/plan` keeps its selector, its `?planId=X` deep links, and its single-plan short-circuit
- No bulk actions, sorting, search, or pagination on the list

## Key Decisions (from Proposal)

1. **Archive, never delete — a standing constraint**, not a preference. `ON DELETE CASCADE` from
   `workout_plans.id` into `workout_sessions` means a delete erases training history and every
   statistic derived from it
2. **Archive is a nullable `archivedAt` column, not an enum value** — folding `"archived"` into
   `workoutPlanStatusEnum` would conflate two orthogonal concepts and leave "failed *and* archived"
   unanswerable
3. **Archiving refuses new sessions and never touches running ones** — stopping someone mid-workout
   to enforce a filing decision is user-hostile
4. **Archive is reversible from the UI** — an irreversible action that is not a delete is a trap
5. **The edit endpoint inherits #357's constraint exactly** — a client-supplied `catalogId` is
   discarded and re-resolved server-side, for the same reason the model never sees the field
6. **Editing cannot affect an in-progress session, and the design pins why** — safe by construction
   (the tracker reads only the session snapshot), so a test guards against a refactor silently
   reintroducing the hazard
7. **Two unverified traces became explicit checks, not assumptions** — "next start reflects the
   edit" and "a removed day 404s" are both proved by tests rather than carried forward as claims
8. **A new `/plans` nav entry**, with "Plan" and "Plans" adjacency recorded as an accepted cost
9. **Mobile gets list and archive; mobile does not get edit** — edit is the only slice with no
   existing infrastructure to extend, and building it twice doubles the largest piece

## Judgment Day

The planning artifacts went through a blind dual-judge review (see `judgment-ledger.md`). Seven
findings, zero contradictions between judges, and no false claim found in any of the seven
artifacts. The ledger closed **ESCALATED** on a CRITICAL completeness gap raised by one judge and
independently verified by the orchestrator.

All seven findings were closed in the artifacts before the PRs they affected were built (commit
`a754024`). The two that changed the shipped product:

- **Finding 2 (CRITICAL)** — the archive-never-delete invariant was scoped to `workout_plans` only,
  but `workout_plans.plan_spec_id` → `plan_specs.id` is `ON DELETE CASCADE`, so a future
  `DELETE /plan-specs/:id` would have destroyed every plan for that spec and all associated history
  while fully complying with the letter of the requirement. The requirement was widened to name the
  whole cascade chain, and the guard test now asserts no `DELETE` on `/workout-plans*` **or**
  `/plan-specs*`
- **Finding 1 (WARNING, both judges)** — `updateProgram` was a full-document replace with no version
  check, giving silent last-write-wins across two tabs. This became the optimistic-concurrency
  requirement and the `updatedAt` version token shipped in PR D

## Recorded Deviations

Three deviations from the design were recorded during PR D and are correct as shipped:

1. **`revalidatePath` lives in the web Server Action, not the API route.** It is a Next.js primitive
   and cannot exist inside Fastify. The design's placement was wrong; the behaviour is not
2. **`GET /workout-plans/:id` gained `updatedAt`.** The edit form must submit back the exact version
   it loaded, so the detail DTO had to carry the version stamp. Reflected in the merged
   `09b-plan-view` spec
3. **The optimistic-concurrency guard compares at `date_trunc('milliseconds', …)`.** `timestamptz`
   stores microseconds while a JS `Date` — and therefore the ISO string the client round-trips —
   carries only milliseconds. Comparing raw would have made every well-behaved edit look like a
   conflict. Fixed in `3160af3`

## Verification Results

### Gates (Freshly Run, 2026-08-09, at archive time)

| Gate | Result |
|---|---|
| `pnpm type-check` | **PASS** — exit 0, all workspaces |
| `pnpm -r --if-present test:coverage` | **PASS** — exit 0 |
| `pnpm build` | **PASS** — exit 0 |

Coverage detail:

| Workspace | Test files | Tests | Functions |
|---|---|---|---|
| apps/api | 189 | 2348 passed, 146 skipped | **91.51%** (≥85) |
| apps/web | 166 | 1816 passed | **93.56%** (≥90) |
| packages/domain | 28 | 339 passed | 100% |
| packages/contracts | 13 | 121 passed | 100% |
| packages/i18n | 7 | 85 passed | 100% |
| packages/exercise-catalog | 2 | 70 passed | 100% |

### Task Completion

All 69 boxes in `tasks.md` are checked. The 10 items in "Final Verification (run once the full chain
has landed)" were still open when the chain merged and were closed at archive time — the four gates
above, four structural greps, and two manual confirmations, each annotated in place with the
evidence that closed it:

- Migration journal entry `idx: 29` (`0029_workout_plan_archived_at`) present and contiguous with
  `idx: 28`
- The no-DELETE guard (`apps/api/src/__tests__/build-app.test.ts`) names both `/workout-plans*` and
  `/plan-specs*`
- No `catalogId` literal reaches `repo.updateProgram`'s call site — the schema has no `catalogId`
  member and the call passes the parsed program, never the raw body
- `tracker-model.ts` still contains zero `programJson` / `WorkoutProgram` / `plan.program`
  references; the only hits are in its own invariant test, which names the tokens to assert their
  absence
- Issue #399 has zero comments — nothing was added after `proposal.md` was written
- `?progress=1` has no effect on trainer-facing reads: `findLatestReadyByOwner`
  (`workout-plan.ts:369-386`) carries no `archived_at` predicate, and the only trainer call site
  (`routes/trainer.ts:308`) uses it rather than `findAllByUser`

### Success Criteria

All 15 proposal success criteria are satisfied by shipped, tested behaviour.

## Known Caveats

### 1. Mobile has no branch for `404 day_not_in_plan` — issue #409 (OPEN)

PR D's web editor can remove a day from a plan. Mobile still starts sessions against a day list it
read earlier, and it has no branch for the new `day_not_in_plan` refusal, so a start against a
removed day shows the wrong message and offers a Retry that can never succeed. The API behaviour is
correct; the mobile client has not caught up.

**Tracked**: [kno/kInorA#409](https://github.com/kno/kInorA/issues/409)

### 2. "Plan" and "Plans" sit adjacent in the nav

Accepted knowingly as part of pinned decision 8, together with the fact that two ways to switch plan
now coexist (`/plan`'s selector and `/plans`). Recorded so a later reader does not reopen it as a
bug. If it proves confusing in real use, it starts as its own naming issue with evidence.

### 3. `09b-plan-view`'s main spec now carries two forms

`09b-plan-view` predates the Requirement/Scenario form and is written as an SC-nn scenario list. The
merge kept that list as the enumerated acceptance record (updating SC-03, SC-07, SC-21 and the
invariants that this change made false, and adding SC-25/SC-26), and appended the two delta
requirements verbatim under a new `## Requirements` heading with a note explaining why both forms
are present. Converting the whole file is a separate, larger cleanup.

## Merged PRs Summary

| PR | Merge commit | Content | Diff | Verdict |
|---|---|---|---|---|
| [#401](https://github.com/kno/kInorA/pull/401) | `0fd6c9e` | A — `/plans` route, nav entry, progress query, swallowed-error fix | +3350/-25 | MERGED |
| [#403](https://github.com/kno/kInorA/pull/403) | `30c6275` | B — `archivedAt` migration, repo filter, archive/unarchive routes, `startSession` refusal | +1712/-144 | MERGED |
| [#407](https://github.com/kno/kInorA/pull/407) | `c603287` | C — mobile plans list and archive (greenfield screen, nav, client) | +1628/-18 | MERGED |
| [#408](https://github.com/kno/kInorA/pull/408) | `f139666` | D — edit the program (web only) | +3278/-18 | MERGED |

Plus `3160af3`, the follow-up fix pinning the edit version token to millisecond precision.

## Implementation Highlights

- **Archive is additive and reversible** — a nullable timestamp, rollback by dropping the column,
  zero data loss by construction
- **Three queries, not N+1** — the list holds its query count flat regardless of plan count, with a
  test that fails if a per-plan query appears
- **The cascade chain is named in the spec, not just the code** — finding 2's fix states *why* no
  `DELETE` may be added, so a later reader cannot reintroduce the hole through a route that is
  technically outside `/workout-plans*`
- **Optimistic concurrency with a distinguishable conflict** — the losing writer is told their edit
  did not save, distinctly from every other rejection reason
- **The tracker invariant is guarded, not merely true** — a test fails if `tracker-model.ts` ever
  starts reading `program_json`
- **Server-side `catalogId` resolution** — the schema has no `catalogId` member, so a
  client-supplied value cannot survive the parse

## Follow-up Work

- **[#409](https://github.com/kno/kInorA/issues/409)** — mobile has no branch for
  `404 day_not_in_plan`; a start against a day removed by the web editor shows the wrong message and
  an impossible Retry
- **Mobile edit-the-program** — deliberately deferred; web edit has now landed and its shape is known
- **Nav adjacency** — "Plan" / "Plans" side by side, to be revisited only with real usage evidence
- **List affordances** — sorting, search and pagination, revisit when a user has enough plans for it
  to matter
- **`09b-plan-view` spec format** — convert the SC-nn list to the Requirement/Scenario form

## Artifacts Included in Archive

- `exploration.md` — read-only investigation; established that `program_json` is written in exactly
  one place and that the tracker never reads it
- `proposal.md` — scope, nine pinned decisions, the resolved question round, PR chain with an honest
  over-budget signal, rollback plan, 15 success criteria
- `design.md` — technical approach, architecture decisions, the tracker invariant with its evidence,
  testing strategy
- `tasks.md` — 69 tasks across PRs A–D plus the final verification checklist
- `judgment-ledger.md` — frozen dual-judge ledger, 7 findings, ESCALATED terminal state
- `specs/plan-management/spec.md` — full new capability spec (12 requirements)
- `specs/09b-plan-view/spec.md` — delta (2 modified requirements)
- `specs/09a-v1-workout-tracking-core/spec.md` — delta (1 modified, 1 added requirement)
- `specs/06-v1-mobile-foundation/spec.md` — delta (1 added requirement)

## State at Close

- **Main branch**: all four PRs merged; latest 17d commit `3160af3`
- **Database**: one migration applied (`0029_workout_plan_archived_at`), journal entry present
- **Specs**: `openspec/specs/plan-management/` created; deltas merged into `09b-plan-view`,
  `09a-v1-workout-tracking-core` and `06-v1-mobile-foundation`; delta specs retained in this archive
  for reference
- **Tests**: all gates green; coverage thresholds met; all 69 tasks complete
- **Open follow-up**: #409

## Closure Notes

The user now owns their plans rather than whichever one the route resolved. Retirement went through
archive rather than delete, so no session record was put at risk, and Judgment Day's verification
that the cascade chain reached further than the requirement said is the most valuable thing this
cycle produced — the invariant it protects is now stated in terms of the chain, not one table. The
edit path shipped last and shipped with the concurrency control that neither the proposal nor the
design originally asked for. The one real gap left open is mobile's missing `day_not_in_plan`
branch, which is filed and tracked.

---

**Archived by**: SDD archive phase
**Date**: 2026-08-09
**For reference**: [kno/kInorA#399](https://github.com/kno/kInorA/issues/399), PRs #401, #403, #407, #408
