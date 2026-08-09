# Exploration — 17d-plan-management

Source issue: [kno/kInorA#399](https://github.com/kno/kInorA/issues/399) — a **Plans** navigation entry leading to a list of the user's plans, each openable, editable and archivable.

Read-only investigation. No code changed.

## Summary

Bigger than "a nav entry and a list". Archive is a genuine additive schema change with an unresolved gating question, and **edit-the-program has no existing write path at all** — regeneration always creates a fresh row through the full LLM pipeline, so a hand-edit endpoint must reinvent that pipeline's post-processing. This is a multi-PR change, and edit-the-program is the strongest candidate for its own slice.

## 1. Where the program lives, and what a hand edit must satisfy

- `workout_plans.program_json` (jsonb) — `apps/api/src/db/schema.ts:669`, typed as `WorkoutProgram`.
- Validated by `WorkoutProgramSchema` (`packages/contracts/src/workout-program.schema.ts:31` → `WorkoutSessionSchema:19` → `WorkoutExerciseSchema:7`). **It has no `catalogId` field.**
- `catalogId` on `WorkoutExercise` is **server-set only**, deliberately absent from the schema the model sees (`packages/contracts/src/index.ts:27-36`). The #357 comment is blunt about why: *"an optional undescribed string there is an invitation the model accepts, filling it with plausible junk."* A hand-edit endpoint inherits that constraint exactly — validate against `WorkoutProgramSchema` (name, sets, reps, restSeconds, notes) and resolve `catalogId` and muscle group **server-side after parsing**. Never trust a client-submitted `catalogId`.

### There is no precedent for editing a stored program

**Verified: `program_json` is written in exactly one place** — `WorkoutPlanRepository.markReady` (`apps/api/src/db/repositories/workout-plan.ts:97`), called once per generation attempt.

Regenerate (`apps/api/src/routes/plan.ts:747-776`) does **not** edit the existing row. It calls `createGenerating` plus a fresh `startGeneration`, producing a **new** `workout_plans` row and retaining the old one for audit (`workout-plan.ts:49-51`).

So "patch this JSON and re-save it" has zero precedent here. Edit-the-program is new machinery, not a variant of something existing.

## 2. An in-progress session on an edited day — safe by construction

Traced end to end:

- `startSession` reads the current `plan.programJson.weeklySessions.find(day)` (`workout-session.ts:399`) **only at session-start time**.
- It then snapshots that day's exercises into `session_exercises` / `set_records` (`:474-475`).
- The live tracker's `deriveTrackerModel` (`apps/web/src/app/(app)/plan/[id]/tracker/tracker-model.ts:157-239`) reads **only `session.exercises`** — the database snapshot. **Verified: zero references to `programJson` in that file.**

**An edit made while someone is mid-workout cannot affect their active session — the tracker has no code path back to `program_json`.** That is safe by construction, not by any explicit guard, which is worth stating in the design so nobody later "optimises" the tracker into reading the plan.

Two consequences not verified empirically:

- Whether the **next** `startSession` for that plan and day picks up the edited program. The code path re-reads `programJson` fresh each call (`:394-399`) and should, but no integration test exercises "edit then start".
- If an edit **removes a day entirely**, `findReadyPlan`'s day lookup (`:399-402`) returns `undefined` and the route 404s. Existing behaviour, but newly reachable through a user action rather than only a data anomaly.

## 3. Archive — schema, semantics, and an open gate

`workoutPlanStatusEnum` is **verified** as exactly `["generating", "ready", "failed"]` (`schema.ts:635-639`) — a **generation lifecycle**, not a visibility flag.

Folding `"archived"` into it conflates two orthogonal concepts and creates an unanswerable case: can a `generating` or `failed` plan be archived while its status still has to express its lifecycle stage? Nothing in the codebase resolves that.

**Recommended shape**: a separate nullable `archivedAt: timestamp | null`. This mirrors the additive/nullable pattern already used by `workout_plans.name` (`schema.ts:663-668`), `workout_sessions.day` (`:712-717`) and `session_exercises.muscle_group` (`:755-762`), each documented as rollback-by-dropping with no data loss.

**`findAllByUser` applies no status filter today** (`workout-plan.ts:158-178`) — it returns generating, ready and failed alike, filtered only by tenant and user. Archive needs a new default `WHERE archived_at IS NULL` plus a "show archived" affordance; there is no existing filter to extend.

**Archiving does not cascade.** The `ON DELETE CASCADE` at `schema.ts:708-710` fires only on a real row delete, which archive exists to avoid. An active session on a just-archived plan keeps working through the existing tracker, complete and abandon routes — no session route checks archive state, because the column does not exist.

**Open, and a pure product decision**: should `startSession` refuse to start a **new** session against an archived plan? There is no existing behaviour to observe.

## 4. Progress data — one grouped query, not N+1

`findAllByUser` today is one query over three plain columns, no joins (`workout-plan.ts:161-176`).

Adding days-per-week, completed sessions and last-trained needs:

- **Days per week** lives in `plan_specs.spec_json.daysPerWeek` (jsonb), not on `workout_plans` — a join or a batched read keyed by `planSpecId` (`schema.ts:607-627`).
- **Completed sessions and last trained** — one aggregate over `workout_sessions` grouped by `workout_plan_id`, counting `status='completed'` and taking `MAX(COALESCE(completed_at, started_at))`.

That is **three queries for the whole page regardless of plan count**, matching the batching pattern already proven in `listSessionHistory` (`workout-session.ts:831-924`): one page query, then `inArray` batches, never per-row.

The N+1 risk is real only if someone implements it as "for each plan, query its sessions". Nothing in the current code does that, and nothing forces it.

## 5. Mobile — entirely greenfield

`apps/mobile/App.tsx:82-256` is a single stack navigator: `Login`, `SignUp`, `Home`, `Tracker`, `History`, `CreatePlanAssistant`, `CreatePlanVoice`, `PlanStatus`, `TrainerPlan`, `ClientList`, `ClientCreatePlan`, `Profile`. **No tab bar, no plan-list screen, no Plans concept.**

`HomeScreen` resolves **one** "current plan" from the dashboard summary and offers a single "View your plan" entry into `PlanStatus`. Its own docstring (`HomeScreen.tsx:9-10`) records that this replaced *"the pre-14a manual `workoutPlanId` paste input that only existed while the app had no plan-list/plan surface"*.

Plan list, archive and edit on mobile are **100% greenfield** — no screen, no nav entry, no client method to extend. The same situation as the profile screen before `17c`.

## 6. Nav naming — no zero-cost option

Both arrays are hardcoded and both carry `{ labelKey: "appNav.plan", href: "/plan" }`: `SidebarNav.NAV_ITEMS` (`SidebarNav.tsx:34-41`) and `MobileNav.PRIMARY_TABS`/`SECONDARY_TABS` (`MobileNav.tsx:20-31`).

**Option A — a new `/plans` entry.** Matches the issue's wording. Costs two nav arrays, two i18n catalogs (a new `appNav.plans` key), and updates to the nav tests that assert nav shape. Leaves "Plan" and "Plans" adjacent — the usability problem itself, unresolved.

**Option B — the list becomes the entry point at `/plan`**, with the week view reached through it. No new nav copy, but it changes established behaviour. Note `plan/page.tsx:90` already hides the selector when only one plan exists; a list-first `/plan` needs the same single-plan short-circuit or every one-plan user meets a list of one. And every existing `/plan?planId=X` deep link (`plan/page.tsx:54-56`) must keep resolving to the week view rather than the list.

Neither is free. This is a genuine fork.

## 7. The swallowed error on this page

**Confirmed** at `plan/page.tsx:36`:

```js
const summaries = listResult.kind === "ok" ? listResult.plans : [];
```

A failed `listPlansAction()` renders the identical "you have no plans" empty state (`:39-51`) as a genuinely empty account. Same class as the six fixed in #396 under #378.

This change already rewrites that page's fetch-and-render logic, so fixing it here is a few lines riding along rather than separable work.

## 8. Size per piece — estimates, not measurements

| Piece | Non-test | Test |
|---|---|---|
| Nav entry (option A) | ~10–15 | ~15–20 |
| List page + progress query + swallowed-error fix | ~230–400 | ~250–400 |
| Archive (migration, repo, route, filter, UI) | ~150–200 | ~150–250 |
| **Edit-the-program** | **~300–450** | **~300–450** |
| Mobile parity (list + archive, deferring edit) | ~150–250 | ~150–250 |

**Every number here is informed judgment from the shape of surrounding code, not measured from a diff.**

**Edit-the-program dominates**, and by a wide margin — it is the only piece with no existing infrastructure to extend. Nav, list and archive each extend something that half-exists; edit extends nothing.

Even the low ends of nav + list + archive + edit clear the 800-line non-test budget before mobile is counted. This is a multi-PR change.

## Risks carried forward

1. Edit-the-program must reinvent `WorkoutProgramSchema` validation plus `catalogId` and muscle-group resolution outside the generation pipeline.
2. Archive implemented as an enum value would conflate visibility with generation lifecycle.
3. Combined size plausibly exceeds the review budget before mobile edit parity is counted.
4. Nav naming has no zero-cost option.
5. The tracker's independence from `programJson` is incidental, not guarded — a future refactor could reintroduce the hazard silently.

## Explicit gaps

- No test or integration check was run confirming "edit a plan, then start a session for that day picks up the new program" — code path traced only.
- The nav test files were not opened; their existence and role come from a coverage listing.
- The size table is estimation.
