# Proposal: 17d-plan-management (the user owns their plans, not just their current one)

GitHub [kno/kInorA#399](https://github.com/kno/kInorA/issues/399). Real implementation. Builds on
`openspec/changes/17d-plan-management/exploration.md` — do not re-derive its evidence.

Roadmap relation: extends `09b-plan-view` (which shipped a selector over an unfiltered list) and
`93b-plan-name` (which gave plans a name worth listing), and adds a write path that
`08-v1-ai-plan-generation` deliberately never had.

Seven product decisions were made by the product owner on 2026-08-09 and are pinned below as
constraints, not options: **archive never delete**, **edit means the program**, **the list shows
progress**, **edit ships inside this change and last**, **a new `/plans` nav entry**, **`startSession`
refuses archived plans**, **the swallowed error is in scope**.

## Intent

A user accumulates plans and can reach exactly one of them. `/plan` resolves a single week view
with a selector, `findAllByUser` returns generating, ready and failed plans with **no filter at all**
(`workout-plan.ts:158-178`), and there is no way to retire a plan that is no longer relevant or to
correct a program the generator got slightly wrong.

Three concrete consequences, all verified:

1. **No retirement path.** Every plan a user ever generated stays in the selector forever, including
   the failed ones. The only removal primitive available is a real delete, and
   `workout_sessions.workoutPlanId` cascades from `workoutPlans.id` (`schema.ts:708-710`) — a delete
   would erase the training history and every statistic derived from it.
2. **No correction path.** `program_json` is written in exactly one place,
   `WorkoutPlanRepository.markReady` (`workout-plan.ts:97`). Regenerate does not edit; it creates a
   new row and keeps the old one for audit. A user who wants three days instead of four must
   regenerate the whole plan and lose the parts that were right.
3. **A failed fetch looks like an empty account.** `plan/page.tsx:36` reduces a failed
   `listPlansAction()` to `[]`, rendering the same "you have no plans" state as a genuinely empty
   account. Same class as the six fixed in #396 under #378.

Success: a user opens a **Plans** entry, sees every plan with how often it trains, how many sessions
they completed and when they last trained it; archives the ones they are done with without losing a
single session record; edits the program of the one they are keeping; and is told when the list fails
to load instead of being told they have nothing.

## Scope

### In Scope

- **A. Plans list.** New `/plans` route and nav entry (`SidebarNav.NAV_ITEMS`,
  `MobileNav.PRIMARY_TABS`/`SECONDARY_TABS`, a new `appNav.plans` i18n key in both catalogs), listing
  every plan with **days per week**, **completed sessions** and **last trained**. Three queries for
  the whole page — list, batched `plan_specs` read by `planSpecId`, one `GROUP BY` over
  `workout_sessions` — following `listSessionHistory` (`workout-session.ts:831-924`). Includes the
  `plan/page.tsx:36` swallowed-error fix (pinned decision 7).
- **B. Archive.** Nullable `archivedAt` column on `workout_plans`, archive and unarchive routes,
  default `WHERE archived_at IS NULL` in `findAllByUser` plus a show-archived affordance, and
  `startSession` refusing to start a **new** session against an archived plan (pinned decision 6).
- **C. Mobile parity — list and archive only.** Greenfield plans screen, nav entry and API client
  methods. Mirrors the profile-screen situation before `17c`.
- **D. Edit the program.** A server-validated write path over `program_json`: days, exercises, sets.
  Ships last (pinned decision 4).

### Out of Scope

- **Any `DELETE` route for plans, now or later.** Standing constraint, not a preference — see pinned
  decision 1.
- **Editing the program on mobile.** Position taken below; web-only in this change.
- **Editing a plan's `PlanSpec`.** The spec describes the generation request, not the program. Changing
  it would imply regeneration, which already exists and already creates a new row.
- **Any change to `workoutPlanStatusEnum`.** It is a generation lifecycle; archive is orthogonal.
- **Changing `WorkoutProgramSchema`**, and specifically **adding `catalogId` to it** — see pinned
  decision 5.
- **Retiring the `/plan` selector.** `/plan` keeps resolving `?planId=X` deep links and keeps its
  single-plan short-circuit (`plan/page.tsx:90`) unchanged.
- **Bulk actions, sorting controls, search, or pagination** on the list.

## Capabilities

### New Capabilities

- `plan-management`: a user lists their plans with progress, archives and unarchives them without
  losing history, and edits a stored program.

### Modified Capabilities

- `09b-plan-view`: the list endpoint gains progress fields and an archived filter; `/plan` is no
  longer the only route that reaches a plan.
- `09a-v1-workout-tracking-core`: `startSession` gains an archived-plan refusal; in-progress sessions
  are explicitly unaffected.
- `06-v1-mobile-foundation`: a plans list surface and nav entry exist on mobile for the first time.

## Approach & Pinned Decisions

**1. Archive, never delete — a standing constraint.** `ON DELETE CASCADE` at `schema.ts:708-710`
means a plan delete takes every `workout_sessions` row with it, and with them completed-session
counts, streaks and personal records. **No `DELETE` route for plans is introduced by this change, and
none should be introduced by a later one.** Acceptance criterion, stated as such.

**2. Archive is a nullable `archivedAt` column, not an enum value.** `workoutPlanStatusEnum` is
verified as exactly `["generating","ready","failed"]` (`schema.ts:635-639`) — a generation lifecycle.
Folding `"archived"` in conflates two orthogonal concepts and creates an unanswerable case: what does
a plan that is both `failed` and archived report? A nullable timestamp mirrors the additive pattern
already used by `workout_plans.name`, `workout_sessions.day` and `session_exercises.muscle_group`,
each documented as rollback-by-dropping with no data loss.

**3. Archiving refuses new sessions and never touches running ones.** Pinned decision 6, and its two
consequences are decided here rather than left to `sdd-design`:

| Situation | Behaviour | Why |
|---|---|---|
| Plan archived while a session is **in progress** | The session continues to work — tracker, complete and abandon all unaffected | Archiving does not cascade; no session route reads archive state. Stopping someone mid-workout to enforce a filing decision is user-hostile |
| User tries to **start a new** session on an archived plan | Refused with a typed error the UI can explain | Pinned decision 6 |
| User wants the plan back | **Unarchive is available from the UI** | Position taken below |

**4. Archive is reversible from the UI.** Not asked in the issue; a position is required. An
irreversible action that is *not* a delete is a trap — the entire reason archive was chosen over
delete is that the user keeps control of their data. Reversal is a single `archivedAt = null` write,
costs a route and a button, and removes the need for a scary confirmation dialog on the archive
action itself. **Position: archive and unarchive are symmetric.** Flagged for confirmation in the
question round.

**5. The edit endpoint inherits #357's constraint exactly.** `catalogId` on `WorkoutExercise` is
**server-set only** and deliberately absent from the schema the model sees
(`contracts/src/index.ts:27-36`). The #357 comment is blunt about why: *"an optional undescribed
string there is an invitation the model accepts, filling it with plausible junk."* The same reasoning
applies with more force to a client. **Validate the submitted program against `WorkoutProgramSchema`,
then resolve `catalogId` and muscle group server-side after parsing. Never trust a client-supplied
`catalogId`.** Not a guideline — a testable requirement.

**6. Editing cannot affect an in-progress session, and the design must pin why.**
`startSession` reads `programJson` only at session-start time (`workout-session.ts:394-399`) and
snapshots that day into `session_exercises`/`set_records` (`:474-475`). `deriveTrackerModel` has
**zero references to `programJson`** — it reads only `session.exercises`. So this is safe **by
construction, not by any guard**, and a future refactor that "optimises" the tracker into reading the
plan would reintroduce the hazard silently. `sdd-design` MUST record this as an invariant with the
verified evidence, and `sdd-apply` MUST land a test that fails if the tracker ever reads
`programJson`.

**7. Two unverified traces become explicit checks, not assumptions.** Exploration traced these
through code and did not execute them. Neither may be carried forward as fact:

| Claim | Status | Required disposition |
|---|---|---|
| The **next** `startSession` after an edit picks up the new program | Traced only, no test exercises "edit then start" | **Apply check**: an integration test that edits a plan and asserts the next session snapshot reflects the edit |
| Removing a day entirely makes `findReadyPlan` 404 (`:399-402`) | Existing behaviour, newly reachable through a user action | **Design check**: reducing 4 days to 3 is a legitimate edit. Design must (a) require an edited program to keep at least one session, (b) ensure no UI surface offers a day the program no longer contains, and (c) turn the bare 404 into a distinguishable "day not in this plan" outcome |

**8. Nav: a new `/plans` entry, with the consequence recorded plainly.** Pinned decision 5. The
product owner chose this over making the list the entry point at `/plan`, knowing it leaves **"Plan"**
and **"Plans"** adjacent in the nav (and "Plan" / "Planes" in Spanish). That adjacency is an accepted
cost, not an oversight; it is recorded here so a later reader does not re-open it as a bug. Cost:
two hardcoded nav arrays (`SidebarNav.tsx:34-41`, `MobileNav.tsx:20-31`), two i18n catalogs, and the
nav tests that assert nav shape.

**9. Mobile gets list and archive; mobile does **not** get edit.** Position required by the brief.
Edit-the-program is the only piece of this change with **no existing infrastructure to extend** — it
is new machinery on web, and building it twice, the second time on a platform that has never had a
plan-list surface at all, doubles the largest and least-precedented slice inside an already
over-budget change. List and archive are different: they are greenfield screens over routes PR B has
already shipped and proven. **Mobile edit becomes a follow-up issue**, filed when web edit lands and
its shape is known rather than guessed. Flagged for confirmation in the question round.

### Changed-line forecast and PR chain

`review_budget_lines: 800`, measured on **non-test** lines.

| PR | Content | Non-test | Test |
|---|---|---|---|
| 1 | A — `/plans` route + nav entry + progress query + swallowed-error fix | ~240–415 | ~265–420 |
| 2 | B — `archivedAt` migration, repo filter, archive/unarchive routes, `startSession` refusal, list UI | ~150–200 | ~150–250 |
| 3 | C — mobile plans list + archive (greenfield screen, nav, client) | ~150–250 | ~150–250 |
| 4 | D — edit the program (web only) | ~300–450 | ~300–450 |
| | **Total** | **~840–1315** | **~865–1370** |

**Honest budget signal (`delivery_strategy: ask-on-risk`): every individual PR sits under the 800-line
non-test budget, but the change as a whole is 1.05–1.65× it. Chaining is mandatory, not a
convenience.** Stating this plainly rather than splitting quietly: the total is above budget, the
split below is on its merits, and the product owner may accept it or trim PR 3.

Every figure is **informed judgment from the shape of surrounding code, not measured from a diff.**

**Boundary rationale:**

- **1 first** — the list is the surface every later slice attaches to. The swallowed-error fix rides
  along because PR 1 rewrites exactly that fetch-and-render logic; extracting it would mean touching
  the same lines twice.
- **2 after 1** — archive needs a list to hide plans from and a show-archived affordance to live in.
  Shipping the column first with nowhere to exercise it is untestable at the product level.
- **3 after 2, before 4** — mobile parity is scoped to precisely what PRs 1 and 2 shipped, so it
  depends on nothing in 4 and is the slice most cleanly droppable if the total is trimmed.
- **4 last** — pinned decision 4, and correct on its merits: it is the largest slice, the only one
  with no infrastructure to extend, and the only one whose review benefits from the list and archive
  surfaces already being settled.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A `DELETE` route is added later and erases session history | **Med — high impact** | Decision 1 is written as a standing constraint; the spec must state it as an invariant, not a scope note |
| A client-supplied `catalogId` is trusted by the edit endpoint | **High if unaddressed** | Decision 5; a test asserting a submitted `catalogId` is discarded and re-resolved server-side |
| A future refactor makes the tracker read `programJson` | Med | Decision 6; invariant plus a test that fails on reintroduction |
| Edit leaves a plan with a day the user can still navigate to | **Med — unverified** | Decision 7; design must resolve all three sub-points before apply |
| The next `startSession` does not pick up an edit | Low — **but untested** | Decision 7; integration test in PR 4 |
| Progress query implemented as N+1 | Med | Three-query shape pinned in scope A, following `listSessionHistory`; review must reject per-plan queries |
| The change total exceeds the review budget | **High — already true** | Stated above rather than hidden; PR 3 is the trim candidate |
| Drizzle journal entry omitted for the `archivedAt` migration | Med | Hand-verify the journal `idx`; a missing entry makes `migrate` silently skip on deploy. This has bitten this repo |
| Coverage gate blocks the chain (apps/api 85%, apps/web 90% functions) | Med | Tests ship in the same commit as each behaviour change |
| Nav shape tests break | Low | Known and mechanical; the nav test files were **not opened during exploration** — their exact assertions are unconfirmed |

## Rollback Plan

- **PR 4 (edit):** revert the route, the client and the form. `program_json` rows already edited stay
  as edited — they are valid `WorkoutProgram` documents by construction, so nothing is corrupted; the
  user simply loses the ability to edit again.
- **PR 3 (mobile):** self-contained new screen and nav entry; revert in isolation.
- **PR 2 (archive):** revert the routes and UI and drop the `archivedAt` column. Every plan becomes
  visible again — the pre-change state exactly, with zero data loss, because archive never deleted
  anything. Revert **before** any DB drop, or the filter queries a missing column.
- **PR 1 (list):** the `/plans` route and nav entry are additive; removing them returns the user to
  `/plan` with its selector. The swallowed-error fix should be retained if the rest is reverted — it
  is strictly a correctness improvement to an existing page.

## Success Criteria

- [ ] A user opens **Plans** from the nav and sees every non-archived plan with days per week,
      completed sessions and last-trained date.
- [ ] The list renders in three queries regardless of plan count; a test asserts no per-plan query.
- [ ] A failed plan-list fetch renders a distinguishable error state, **not** the empty-account state.
- [ ] Archiving a plan removes it from the default list, and a show-archived affordance brings it back
      into view.
- [ ] Archiving a plan destroys **zero** `workout_sessions` rows; a test asserts the session count is
      unchanged before and after.
- [ ] No `DELETE` route exists for plans; a test or lint asserts the route table has none.
- [ ] `startSession` refuses a new session against an archived plan with a typed, explainable error.
- [ ] A session already in progress when its plan is archived can still be tracked, completed and
      abandoned.
- [ ] An archived plan can be unarchived from the UI and behaves exactly as before archiving.
- [ ] Editing a plan's program persists days, exercises and sets, and a submitted `catalogId` is
      discarded and re-resolved server-side.
- [ ] Editing a plan while a session is in progress leaves that session's exercises untouched; a test
      fails if `tracker-model.ts` ever reads `programJson`.
- [ ] The **next** session started after an edit reflects the edited program.
- [ ] An edited program cannot be saved with zero sessions, and no UI surface offers a removed day.
- [ ] Mobile lists and archives plans with the same semantics as web.
- [ ] `pnpm type-check`, `pnpm -r test`, `pnpm -r --if-present test:coverage` and `pnpm build` are
      green; the Drizzle journal entry for the `archivedAt` migration is present.

## Proposal question round — RESOLVED (product owner, 2026-08-09)

Decisions 1–7 from the exploration round are settled and were not reopened. These four were not
covered by that round and needed a position rather than a silence. **All four positions below were
confirmed as written** — none was corrected, and no second round was requested.

One consequence worth carrying forward deliberately: items 4 and decision 8 stack. Two nav entries
named "Plan" and "Plans" sit adjacent, *and* two ways to switch plan coexist. That is two layers of
the same ambiguity, accepted knowingly. If either proves confusing in use, the follow-up below is
where it gets revisited — not a reason to reopen the design now.

1. **Does mobile get edit-the-program in this change? → Position: NO** (decision 9). Mobile ships list
   and archive; mobile edit becomes a follow-up issue. Accepted consequence: for a period, a user can
   edit their program on web and not on their phone.
2. **Is archive reversible from the UI? → Position: YES, symmetric unarchive** (decision 4). Accepted
   consequence: one extra route and one extra button, and archive stops being a decision the user has
   to be warned about.
3. **Can a `generating` or `failed` plan be archived? → Position: YES.** `archivedAt` is orthogonal to
   `status`, and a stack of failed generations is exactly the clutter this list needs to hide. Any
   other answer would require a status gate that decision 2 exists to avoid.
4. **Does `/plans` replace the `/plan` selector? → Position: NO.** `/plan` keeps its selector, its
   `?planId=X` deep links (`plan/page.tsx:54-56`) and its single-plan short-circuit (`:90`). Accepted
   consequence: two ways to switch plan exist side by side, which is the same adjacency cost already
   accepted in decision 8.

## Follow-up work

- **Mobile edit-the-program** — file once web edit lands and its shape is known.
- **Nav adjacency** — "Plan" and "Plans" side by side is an accepted cost here; if it proves confusing
  in use, it starts as its own naming issue with real evidence, not as a re-litigation of decision 8.
- **List affordances** — sorting, search and pagination are deliberately absent; revisit only when a
  real user has enough plans for it to matter.
