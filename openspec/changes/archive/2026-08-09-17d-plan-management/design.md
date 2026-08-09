# Design: 17d-plan-management

Implements the nine pinned decisions of `openspec/changes/17d-plan-management/proposal.md` (plus its
RESOLVED question round) over the evidence in `exploration.md`. This document owns the HOW: the
`archivedAt` column and its filter, the three-query progress read, `startSession`'s typed refusal, the
edit write path, the tracker invariant, the mobile surface, the nav seam, and the PR boundaries. It
does not restate the product decisions and does not reopen them.

Every claim marked **verified** was checked by opening the file named beside it during this phase.
Five of the proposal's working assumptions did not survive that check. They are called out in
**Corrections to the proposal**, and two of them move work between PRs.

**Tooling note, stated rather than glossed:** this phase had **no shell tool**, so
`gh issue view 399` could not be run. The issue's content is taken from `proposal.md`,
`exploration.md` and Engram `#2697`, which were written while the issue was open. Nothing below
depends on a detail of the issue that those three do not already record.

## Technical Approach

Four seams, one genuinely new capability:

1. **A nullable `archivedAt` column** on `workout_plans`, with the filter defaulted at the repository
   boundary — `findAllByUser` today applies no filter of any kind (`workout-plan.ts:158-178` —
   verified), so the default is created here rather than extended.
2. **One list read with an opt-in progress projection**: three bounded queries — plans, a batched
   `plan_specs` read keyed by `planSpecId`, one grouped aggregate over `workout_sessions` — following
   the batching shape `listSessionHistory` already proves (`workout-session.ts:839-894` — verified).
3. **Two typed refusals added to `startSession`'s Phase 2**, the phase that already exists precisely
   to validate the target before anything is written (`workout-session.ts:393-402` — verified). Both
   sit *after* the resume branches, which is what makes "does not break a running session" structural
   rather than tested-for.
4. **An edit write path that reuses the generation pipeline's post-processing instead of
   reimplementing it.** `resolveProgramCatalogIds` (`catalog-resolution.ts:63-97`) is already pure,
   total and free of service state — verified. The edit route calls it directly.

The genuinely new capability is the edit endpoint. Everything else extends something that half-exists.

## Corrections to the proposal

| Proposal / brief claim | Verified reality | Consequence for this design |
|---|---|---|
| Decision 5 and the brief: the edit endpoint resolves "`catalogId` **and muscle group** server-side after parsing" | **Muscle group is not part of `program_json` at all.** It is a `session_exercises` column derived at session-start by `deriveExerciseMuscleGroup(exercise)` (`workout-session.ts:1781`), which reads only `{ name, catalogId }` (`catalog-muscle-group.ts:155-167`) — both verified | The edit path resolves **`catalogId` only**. Muscle group follows automatically on the next `startSession`, correctly and with no new code. Adding a muscle-group resolution to the edit path would create a second derivation site for a value the schema does not store — the exact drift the brief asked to avoid |
| Exploration §1: a hand-edit endpoint "must reinvent that pipeline's post-processing" | **It must not, and must not be allowed to.** `resolveProgramCatalogIds` is a free function, pure and total, taking `(program, allowedIds)` and nothing else (`catalog-resolution.ts:63-97`). `PlanGenerationService.linkToCatalog` (`generation-service.ts:427-468`) is a thin observability wrapper around it, not the logic | **Reuse verbatim; extract nothing.** The only thing the edit route derives itself is `allowedIds`, and that is one call to `resolveExerciseVocabulary(spec.equipment)` — the same call `buildVocabulary` makes (`generation-service.ts:392`). `buildVocabulary`'s other half (`capVocabularyForPrompt`) is a *prompt token budget* and is irrelevant to an edit, so extracting the whole method would import a concern that does not apply |
| Brief: "Migration number: journal max is currently 28, so verify and pick correctly" | **Confirmed, with a filename trap beside it.** `meta/_journal.json` max `idx` is `28` (`0028_user_weight_entries` — verified at `_journal.json:202-206`). But `drizzle/` holds **29** `.sql` files, because `0011` is used twice (`0011_billing_plans_tiers.sql` and `0011_abnormal_squadron_sinister.sql`) | The next migration is `0029_workout_plan_archived_at.sql` at **`idx: 29`**. Deriving the number from the file count would produce `0030` and a gap — the journal, not the directory, is authoritative |
| Brief: the `17b` journal guard "is directory-driven and covers new migrations automatically — confirm rather than assume" | **Confirmed.** Both structural assertions read the directory and the journal from disk (`migration-journal.test.ts:38-43`, `:46-68`); neither carries a hardcoded list | No hand-check and no list edit. The file's *third* style of test pins one specific migration per change (`:70-95`); PR B adds one matching four-line assertion for `idx: 29`, following that convention |
| Proposal scope A: the nav entry goes in "`MobileNav.PRIMARY_TABS`/`SECONDARY_TABS`" | **`PRIMARY_TABS` cannot take a fourth entry without a layout change.** The bar renders `PRIMARY_TABS.slice(0, 2)`, then the Create FAB, then `PRIMARY_TABS.slice(2)`, then the More button (`MobileNav.tsx:128-169` — verified). A fourth primary tab lands to the right of the FAB and crowds a bar whose docstring records #294's "a small, fixed-width bar can never overflow" as the reason it exists (`:33-42`) | **`/plans` goes in `SECONDARY_TABS`** (the More menu), beside Statistics / Exercises / Profile. This is also the cheaper answer to decision 8's accepted "Plan"/"Plans" adjacency: on the narrow viewport the two never sit side by side |
| Judgment Day finding 2 (CRITICAL, single judge, orchestrator-verified): "no `DELETE` route for `workout_plans`" was scoped too narrowly | `workout_plans.plan_spec_id` → `plan_specs.id` is `ON DELETE CASCADE` (`schema.ts:659-661`), so a future `DELETE /plan-specs/:id` would cascade into `workout_plans` → `workout_sessions` → `session_exercises` → `set_records`, destroying training history while never touching `/workout-plans*`. No such route exists today — the gap was latent, not exploited | The spec requirement and the guard test (below) now name `plan_specs` explicitly and state the cascade chain, so the prohibition and its reason travel together |

**Confirmed exactly as the proposal states**, checked rather than assumed:

- `workoutPlanStatusEnum` is exactly `["generating","ready","failed"]` (`schema.ts:635-639`).
- `program_json` is written in exactly one place, `markReady` (`workout-plan.ts:90-101`).
- `workout_sessions.workoutPlanId` cascades from `workoutPlans.id` (`schema.ts:708-710`).
- `findAllByUser` filters on tenant and user only (`workout-plan.ts:158-178`).
- `tracker-model.ts` has zero references to `programJson` — see **The tracker invariant**.
- `plan/page.tsx:36` reduces a failed list fetch to `[]`.
- The CI integration job **globs** `src/db/repositories/__tests__/*.integration.test.ts` and a guard
  fails the job when a suite on disk was not invoked (`.github/workflows/ci-cd.yml:113-144`). A new
  suite is picked up with **no workflow edit** — stating that explicitly, as the brief asked.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Archive representation | Nullable `archived_at timestamptz` on `workout_plans` | An `"archived"` member on `workoutPlanStatusEnum`; a boolean | Pinned decision 2. A timestamp also answers "when", which a boolean cannot, at identical cost — the same choice `workout_sessions.completedAt` already makes |
| Where the archived filter lives | In `findAllByUser`, as the **default**, with an explicit `includeArchived` opt-in | A filter in the route; a filter in the page | A default that must be requested at every call site is not a default. The repository is the only layer every reader passes through |
| Progress projection delivery | The **same** `GET /workout-plans` endpoint, with an opt-in `?progress=1` query param and additive optional DTO fields | A second `GET /workout-plans/progress` route; making progress unconditional | A second endpoint returning a near-identical list is precisely the drift that produces two answers to "what plans does this user have". Opt-in keeps `/plan`'s selector byte-identical in cost (one query), while `/plans` pays three. The endpoint's shape stays one thing |
| Progress query shape | Three queries: plans, `inArray` batch over `plan_specs`, one `GROUP BY workout_plan_id` aggregate | A three-way join; a per-plan lookup | Mirrors `listSessionHistory` (`workout-session.ts:839-894`). A join would multiply plan rows by session rows and force a `DISTINCT`; the batch keeps each query's result set the size of its own table |
| Where `daysPerWeek` is read | In TypeScript, from the batched `spec_json` object | A SQL jsonb operator (`spec_json->>'daysPerWeek'`) | `spec_json` is untyped `jsonb` (`schema.ts:617`). A SQL extraction returns `string \| null` with no way to check the shape; reading it in TS lets a malformed or legacy spec degrade to "unknown" instead of to `NaN` |
| `startSession` refusal placement | **Phase 2**, immediately after `findReadyPlan`, before the Phase 3 transaction | Inside `findReadyPlan`'s WHERE clause; a route-level pre-check | Phase 2 already exists to "validate the TARGET plan+day before abandoning anything" (`workout-session.ts:333-334`). Adding `archived_at IS NULL` to `findReadyPlan`'s predicate would collapse "archived" into the same `undefined` as "not found", which is the opposite of a typed refusal |
| Refusal transport | Two new variants on `StartSessionOutcome`: `plan_archived` and `day_not_in_plan` | Keeping `undefined` and disambiguating by error string; a thrown error | `undefined` already means three different things at this boundary. A discriminated variant is what the union is for, and the repo's precedent (`AbandonSessionOutcome`, `DeleteSessionOutcome` — `contracts/src/index.ts:176-194`) is exactly this |
| Edit HTTP verb | `PUT /workout-plans/:id/program` — full document replacement | `PATCH` with a partial merge | A partial merge into a jsonb document has no well-defined semantics for "remove exercise 3 of day 2". A full replacement makes the submitted document the whole truth, which is also what makes `WorkoutProgramSchema` a complete validation rather than a partial one |
| How a client `catalogId` is discarded | By the Zod parse itself — `WorkoutProgramSchema` is a plain `z.object`, which **strips** unknown keys, and it has no `catalogId` member (`workout-program.schema.ts:7-14`) | A manual delete pass over the parsed program | Decision 5 becomes structural: the field cannot survive the parse, so no later code has to remember to drop it. Still asserted by a test — a structural guarantee nobody checks is one refactor from being a claim |
| Edit's extra invariants | A pure `validateEditedProgram` in `packages/domain` | Inline checks in the route | Decision 7(a) ("at least one session") plus uniqueness and day-range rules are the part most likely to be got wrong and the part a removed-day bug hides in. A pure function is proved by `pnpm -r test` on every push; a route-only rule needs the integration harness |
| `limitationWarnings` on edit | **Preserved from the stored program; the submitted value is ignored** | Accepting the client's array | #260 made these deterministic, localized and the single source of truth (`generation-service.ts:271-281`). Accepting them from a client would let arbitrary prose into a field the product presents as system-authored — and would let a user silently erase a safety warning |
| Editable plan states | `ready` only; `generating`/`failed` → `409 plan_not_ready` (now a requirement — see `specs/plan-management/spec.md`) | Allowing any status | **Corrected (Judgment Day finding 5).** The original rationale claimed this prevents "a real lost-update race" against an in-flight `markReady` overwriting the edit. Verified false: no code path ever flips an existing row from `ready` back to `generating` — `status = 'generating'` is set only by `createGenerating`'s INSERT (`workout-plan.ts:67-79`), and regenerate creates a brand-new row rather than mutating the one being edited (`plan.ts:738`). The gate is kept as harmless defence-in-depth, but its real justification is structural: `program_json` is `NULL` until `markReady` runs (`workout-plan.ts:90-101`), so a non-`ready` plan simply has no program to edit — there is nothing there to validate or persist |
| Concurrency control on the edit write (Judgment Day finding 1, confirmed by both judges) | **Optimistic**: the caller submits `expectedUpdatedAt` (the `updatedAt` it loaded); the `UPDATE` is conditioned on it and returns `409 edit_conflict` on a mismatch | A dedicated integer version column; HTTP `ETag`/`If-Match`; last-write-wins (the status quo before this fix) | `workout_plans.updated_at` already exists and `markReady` already bumps it on every write (`workout-plan.ts:97`), so no schema change is needed — the column already carries version semantics. A dedicated version column or conditional-request headers would duplicate that for no added precision. Last-write-wins is exactly the finding: two tabs editing the same plan produced a silent overwrite with no signal to either user |
| Editing an **archived** plan | Allowed server-side; no edit affordance rendered on an archived row | Refusing with a 409 | Archive is a filing decision, and the question round already established a `failed` plan may be archived. No session can be started on it anyway, so an edit is inert until it is unarchived. Adding an unrequested gate is scope the product did not ask for |
| Write scope on the edit repo method | `WHERE tenant AND user AND id` | `markReady`'s tenant-only scope | `markReady`'s tenant-only scope is documented as safe because the generation service owns the write and already holds the binding (`workout-plan.ts:86-88`). A user-facing route holds a client-supplied id and must be user-scoped, exactly like `findById` (`:187-203`) |
| Mobile nav entry | `SECONDARY_TABS` on web's `MobileNav`; a HomeScreen entry on the native app | A fourth `PRIMARY_TABS` entry; a native tab bar | See the corrections table for web. Native has no tab bar at all (`App.tsx:82-95`); `HomeScreen` is the hub, and Profile already sits there as the precedent (`HomeScreen.tsx:216`) |
| Mobile API client | Extend `apps/mobile/src/api/plan-status-client.ts` | A new `plan-list-client.ts` | That module already owns every plan read on mobile and already has `NO_SESSION`, `requestInit` and `mapError` (`plan-status-client.ts:127-198`). A fifth client would duplicate the error taxonomy the screens branch on |

## Archive: the column, the filter, the routes

### Schema

```sql
-- apps/api/drizzle/0029_workout_plan_archived_at.sql
ALTER TABLE "workout_plans" ADD COLUMN "archived_at" timestamp with time zone;
```

```ts
// schema.ts — workoutPlans, beside `name`
/**
 * 17d: when the user retired this plan from their active list. NULL = active.
 * Orthogonal to `status`, which is a GENERATION lifecycle — a plan may be
 * `failed` and archived at once. Additive and nullable, like `name` above:
 * rollback is a column drop with zero data loss, because archiving never
 * deletes anything (`workout_sessions` cascades from this row's DELETE, which
 * is exactly why this change introduces no DELETE route).
 */
archivedAt: timestamp("archived_at", { withTimezone: true }),
```

Journal entry hand-added at `idx: 29`, tag `0029_workout_plan_archived_at`. No
`meta/*_snapshot.json` — snapshots stop at `0024` and `0025`–`0028` are the precedent.

### The filter

```ts
async findAllByUser(
  tenantId: string,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<WorkoutPlanSummary[]>
```

`archived_at IS NULL` is appended to the existing `and(...)` unless `includeArchived` is true. The
option is optional and defaults to the filtered behaviour, so every existing call site — `/plan`'s
selector included — silently gains the filter, which is the intended product behaviour.

`WorkoutPlanSummary` gains `archivedAt: Date | null` (repo) / `archivedAt?: string | null` (DTO), so
the show-archived view can render "archived on …" without a second read.

### The routes

| Route | Behaviour |
|---|---|
| `POST /workout-plans/:id/archive` | `200 { id, archivedAt }`. Idempotent: archiving an already-archived plan returns its existing `archivedAt` unchanged, never a second timestamp |
| `POST /workout-plans/:id/unarchive` | `200 { id, archivedAt: null }`. Idempotent the same way |
| both | `404 { error: "not_found" }` when the scoped `(tenantId, userId, id)` predicate matches nothing — indistinguishable from another user's plan, the same no-IDOR-leak discipline `abandonSession` documents |

`POST` rather than `PATCH` follows the repo's own precedent for state transitions
(`/workout-sessions/:id/complete`, `/abandon` — `routes/workout-session.ts:248`). One repository
method backs both:

```ts
/**
 * Set or clear `archived_at` for one plan owned by the caller.
 *
 * Idempotent by construction: `archived_at` is written to `now()` only when it
 * is currently NULL (`COALESCE(archived_at, now())` on the archive path), so a
 * repeated archive cannot move the timestamp. Scoped by tenant AND user; 0 rows
 * updated resolves to `undefined` → 404.
 *
 * This is the ONLY write path for the column, and there is deliberately no
 * delete counterpart: `workout_sessions` cascades from a plan DELETE
 * (`schema.ts:708-710`), which would erase the training history archive exists
 * to preserve.
 */
async setArchived(
  tenantId: string, userId: string, id: string, archived: boolean,
): Promise<{ id: string; archivedAt: Date | null } | undefined>
```

## The progress read

One method, three queries, on `WorkoutPlanRepository`. It reads `plan_specs` and `workout_sessions`
directly — cross-table reads inside a repository are established here (`workout-session.ts` reads
`workoutPlans` at `:1738-1756` and `:1730`).

```ts
/** One plan as the /plans list needs it: identity, filing state, progress. */
export interface WorkoutPlanProgressSummary extends WorkoutPlanSummary {
  /**
   * `plan_specs.spec_json.daysPerWeek`. `undefined` — never 0 — when the spec
   * row is missing or its JSON has no usable number: "unknown" and "trains zero
   * days a week" are different statements and the UI renders them differently.
   */
  daysPerWeek?: number;
  /** Sessions with `status = 'completed'` for this plan. 0 for a plan never trained. */
  completedSessions: number;
  /** MAX(COALESCE(completed_at, started_at)) over those sessions; `undefined` when none. */
  lastTrainedAt?: Date;
}

async listPlansWithProgress(
  tenantId: string, userId: string, options: { includeArchived?: boolean } = {},
): Promise<WorkoutPlanProgressSummary[]>
```

**Q1** — `findAllByUser`'s select, plus `planSpecId` and `archivedAt`, same ordering, same filter.
Returns `[]` → the method short-circuits and issues **no** further query (the
`sessionRows.length === 0` guard `listSessionHistory:853` already uses).

**Q2** — `select({ id, specJson }).from(planSpecs).where(inArray(planSpecs.id, specIds))`. Ids come
from Q1, which is already tenant+user scoped, so this cannot reach another user's spec. `daysPerWeek`
is read in TS: `typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined`.

**Q3** — one grouped aggregate:

```sql
SELECT workout_plan_id,
       count(*) FILTER (WHERE status = 'completed')                                AS completed,
       max(coalesce(completed_at, started_at)) FILTER (WHERE status = 'completed')  AS last_trained
FROM workout_sessions
WHERE tenant_id = $1 AND user_id = $2 AND workout_plan_id = ANY($3)
GROUP BY workout_plan_id
```

`COALESCE(completed_at, started_at)` matches the ordering expression `listSessionHistory:849` already
uses, so "last trained" and the history page cannot disagree about a session's date. Both aggregates
are gated on `status = 'completed'`: an abandoned session is a truthful record of what was logged
(17b's reasoning), but it is not a session the user *completed*, and the list column says
"completed sessions".

**A plan with zero sessions is simply absent from Q3's result.** The merge therefore defaults to
`completedSessions: 0` and omits `lastTrainedAt` — no row, no lookup miss, no `null` masquerading as a
date. Stated because it is the case a `LEFT JOIN` implementation would get subtly wrong.

The route exposes this behind `?progress=1`; without the flag the handler calls `findAllByUser` and
the response is byte-identical to today's.

## `startSession`: the two typed refusals

Both land in **Phase 2**, between the resume/conflict fast path and the transaction
(`workout-session.ts:393-402`):

```ts
// ── Phase 2 — validate the TARGET before abandoning anything ────────
const plan = await this.findReadyPlan(tenantId, userId, workoutPlanId);
if (!plan?.programJson) {
  return undefined;                         // unchanged: plan unavailable → 404 not_found
}

// 17d: archive refuses a NEW session and nothing else. Reaching this line
// already means neither resume branch matched, so an in-progress session on
// this plan has been returned above and never sees this check.
if (plan.archivedAt !== null) {
  return { kind: "plan_archived" };
}

const plannedSession = plan.programJson.weeklySessions.find((s) => s.day === day);
if (!plannedSession) {
  // 17d decision 7(c): distinguishable from "no such plan". An edit that removes
  // a day makes this reachable through a user action, so the client must be able
  // to say WHICH days remain rather than render a bare 404.
  return {
    kind: "day_not_in_plan",
    availableDays: plan.programJson.weeklySessions.map((s) => s.day).sort((a, b) => a - b),
  };
}
```

### Why this cannot break a session already in progress

Three independent reasons, all verified, in decreasing order of strength:

1. **No session route reads the column, because no session route reads the plan.** `findReadyPlan`
   has exactly **one** caller in the whole repository — `startSession`'s Phase 2 (`:394`; the only
   other occurrence is its definition at `:1738`). `recordSet`, `completeSession` and `abandonSession`
   never touch `workout_plans` at all. A missing channel, not a convention.
2. **The check sits after both resume branches.** Branch A (Phase 1, `:362-370`) returns `resumed`
   for a same-plan-same-day active session before Phase 2 runs at all. A user mid-workout who
   re-opens the tracker gets their session back whether or not the plan was archived a second ago.
3. **The refusal returns before the transaction opens** (`:405`), so it writes nothing and
   auto-closes nothing — the property Phase 2 was introduced for.

**One honest edge**, recorded rather than discovered later: Phase 3 re-decides under the lock and can
also return `resumed` (`:419-426`). Phase 2 sits between them, so in the narrow race where Phase 1's
unlocked read misses an active session that Phase 3 would have resumed, an archived plan yields
`plan_archived` instead of `resumed`. The user re-taps and Phase 1 now sees the session. This is a
strictly better outcome than the alternative — moving the check into Phase 3 would put it after the
auto-close UPDATE, i.e. it would abandon a stale session and *then* refuse.

### Route mapping

```ts
if (outcome.kind === "plan_archived") {
  return reply.code(409).send({ error: "plan_archived" });
}
if (outcome.kind === "day_not_in_plan") {
  return reply.code(404).send({ error: "day_not_in_plan", availableDays: outcome.availableDays });
}
```

`409` for archived: the request is well-formed and the plan exists — it is a state conflict, the same
class as `active_session_conflict`. **`404` is kept for `day_not_in_plan`** deliberately: both web
(`tracker-client.ts:64-69`) and mobile (`plan-status-client.ts:159-170`) branch on the HTTP status,
and `404` already routes to `NOT_FOUND` / poison-drop in the offline flush taxonomy. Changing the
status would move an existing behaviour for a message improvement; changing only the body key adds the
distinguishability decision 7(c) asked for and breaks nothing.

## The edit write path

`PUT /workout-plans/:id/program`, body `{ program: WorkoutProgram, expectedUpdatedAt: string }`. Seven
ordered steps; the order is the design.

```
1. Fastify JSON schema         → 400 on a malformed envelope
2. WorkoutProgramSchema.parse  → 422 invalid_program        [strips catalogId structurally]
3. validateEditedProgram       → 422 <specific reason>      [pure, packages/domain]
4. load plan (tenant+user+id)  → 404 not_found | 409 plan_not_ready
5. resolve catalogIds          → reuse, never reimplement
6. updateProgram               → 200 { id, program, updatedAt } | 409 edit_conflict
7. (on 0 rows) re-read scoped row → disambiguate 404 / 409 plan_not_ready / 409 edit_conflict
```

**Step 6 is the fix for Judgment Day finding 1 (confirmed by both judges): no concurrency control on
the edit endpoint.** The edit form loads a plan and displays its `updatedAt`; the save request carries
that value back as `expectedUpdatedAt`. `updateProgram` conditions its `UPDATE` on it:

```sql
UPDATE workout_plans
SET program_json = $1, updated_at = now()
WHERE tenant_id = $2 AND user_id = $3 AND id = $4
  AND status = 'ready' AND updated_at = $5
RETURNING *
```

Zero rows updated is ambiguous between three causes — not found, not ready, or a version mismatch —
so step 7 re-reads the scoped row (tenant+user+id only, no status/version filter) to disambiguate: no
row → `404 not_found`; row exists but `status != 'ready'` → `409 plan_not_ready`; row exists, ready,
but `updated_at` no longer equals the submitted `expectedUpdatedAt` → `409 edit_conflict`. The conflict
response carries the plan's *current* `updatedAt` so the losing writer's client can say "this plan
changed elsewhere — reload to see the latest version" instead of failing silently, which is the
requirement Judgment Day asked for by name.

**Step 2 is where decision 5 is enforced, and it costs nothing.** `WorkoutProgramSchema` is a plain
`z.object` with no `catalogId` member (`workout-program.schema.ts:7-14`), and Zod's default object
behaviour strips unknown keys. A submitted `catalogId` therefore cannot survive the parse — it is
gone before any of our code sees the program. The test still asserts it: a structural guarantee nobody
checks is one `.passthrough()` away from being a claim.

**Step 3** — the rules `WorkoutProgramSchema` cannot express:

```ts
// packages/domain/src/plan/edited-program.ts — NEW
export type EditedProgramIssue =
  | "empty_program"      // decision 7(a): zero sessions would 404 every start
  | "duplicate_day"      // two sessions claiming day 2 — the `.find()` at startSession:399 takes one silently
  | "invalid_day"        // outside 1..7; the start route's own bound (routes/workout-session.ts:107)
  | "empty_session";     // a day with no exercises snapshots an empty workout

/** Pure, total: no I/O, no throw. Returns every issue found, in document order. */
export function validateEditedProgram(program: WorkoutProgram): EditedProgramIssue[];
```

`invalid_day`'s bound is copied from the start route's `day: { minimum: 1, maximum: 7 }`
(`routes/workout-session.ts:107` — verified). An edit that stored day 8 would produce a day the tracker
can render and `startSession` will reject at the schema layer, which is a worse failure than refusing
the edit.

**Step 5** — reuse, spelled out because "reuse is strongly preferable" was the brief's word and this is
where it is honoured:

```ts
// 17d, corrected (Judgment Day finding 6): the real method is `findConfirmedById`
// (`plan-spec.ts:29-65`), not `findSpecById`, which does not exist. It also
// requires `confirmed: true` — every plan_specs row a `ready` workout_plans row
// can reference was confirmed before generation started, so this should never
// miss for a plan reaching `ready`; if it somehow does, the route treats the
// undefined spec the same as a missing plan (404 not_found).
const spec = await repo.findConfirmedById(tenantId, userId, plan.planSpecId);
const { exercises } = resolveExerciseVocabulary(spec.equipment);   // same call as generation-service.ts:392
const allowedIds = new Set(exercises.map((r) => r.id));            // same set as generation-service.ts:414
const { program: linked } = resolveProgramCatalogIds(parsed, allowedIds);
```

The **full** vocabulary, not the prompt-capped subset — `catalog-resolution.ts:53-58` states why, and
an edit has no prompt and therefore no budget to respect. Unresolved exercises are kept as free text
with no id, exactly as generation does; a miss must not fail a user's edit any more than it fails a
generation. The `unresolved` list is reported through `observability.recordEvent` with
`event: "plan.edit_exercise_unresolved"`, ids and the exercise name only — the same payload discipline
`linkToCatalog` already applies (`generation-service.ts:439-453`).

**Step 6** — `limitationWarnings` are carried over from the stored program, never from the body:

```ts
const next = { ...linked, limitationWarnings: plan.programJson.limitationWarnings };
```

```ts
/**
 * 17d: replace `program_json` for one plan owned by the caller.
 *
 * The SECOND write path for this column, and deliberately narrower than
 * `markReady`: scoped by tenant AND user (a client-supplied id), guarded on
 * `status = 'ready'` so it can never race an in-flight generation's
 * `markReady`, and guarded on `expectedUpdatedAt` so it can never silently
 * overwrite a concurrent edit (Judgment Day finding 1) — the caller's version
 * of the row must still be current. Returns undefined on 0 rows so the route
 * can distinguish 404 / 409 plan_not_ready / 409 edit_conflict by re-reading
 * the scoped row.
 */
async updateProgram(
  tenantId: string, userId: string, id: string, program: WorkoutProgram, expectedUpdatedAt: Date,
): Promise<WorkoutPlanRecord | undefined>
```

The route revalidates `/plan` and `/plans` on success, so the same tab cannot keep rendering day tiles
the program no longer contains (decision 7(b)).

## The tracker invariant

The proposal requires this to become a guarded property rather than an accident. Graded honestly,
strongest first:

**1. Structural — a missing channel.** `deriveTrackerModel` takes a `WorkoutSessionRecord` and reads
`session.exercises`, the database snapshot written at start (`workout-session.ts:474-475`).
`WorkoutSessionRecord` has **no** program member and this change does not add one. There is therefore
no path by which `program_json` can reach the tracker: someone would have to add a field to the
contract, populate it in the repository mapping, and read it — three deliberate edits. This is the
same shape as 17c's "Why PRs cannot move", and it is the real guarantee.

**2. A source-scan guard test.** The structural argument protects the *record*; it does not stop
someone importing a plan client into `tracker-model.ts` directly. A guard in the family this repo
already accepts for silent-failure classes (`migration-journal.test.ts`):

```ts
// apps/web/src/app/(app)/plan/[id]/tracker/__tests__/tracker-model.invariant.test.ts — NEW
// 17d: the tracker renders the DB snapshot, never the plan. An edit made while
// someone is mid-workout must not reach their active session, and today that is
// true because this file has no reference to the program. Pin it: a refactor
// that "optimises" the tracker into reading `programJson` fails here loudly
// instead of silently rewriting a live workout.
it("never references the stored program", () => {
  const source = readFileSync(trackerModelPath, "utf-8");
  expect(source).not.toMatch(/programJson|WorkoutProgram|plan\.program/);
});
```

**3. A behavioural integration test** (PR D): start a session, edit the plan's program, assert the
active session's `session_exercises` and `set_records` are byte-identical afterwards.

It is a lint plus a fixture, not a type. Stating the limit is part of the design: a determined
refactor that renames the symbol defeats (2), and (1) is what actually holds.

## The two unverified traces (decision 7)

| Claim | Disposition here |
|---|---|
| The **next** `startSession` after an edit picks up the new program | **Apply check, PR D.** An integration test in `apps/api/src/db/repositories/__tests__/workout-plan-edit.integration.test.ts`: seed a ready plan, `updateProgram` with a changed exercise name, `startSession` the same day, assert the new `session_exercises` row carries the edited name. The code path re-reads `programJson` on every call (`:394-399`), so this should pass on the first run — if it does not, the design is wrong, not the test |
| Removing a day makes `findReadyPlan`'s lookup 404 | **Resolved in design, proved in apply.** (a) `validateEditedProgram` rejects a zero-session program; (b) every web day surface derives from `plan.program.weeklySessions`, and the edit route revalidates `/plan`; (c) the bare 404 becomes `day_not_in_plan` with `availableDays`. Same integration suite: edit 4 days down to 3, start the removed day, assert `409`-free `404 { error: "day_not_in_plan", availableDays: [1,2,3] }` |

## Interfaces / Contracts

```ts
// packages/contracts/src/index.ts

export type StartSessionOutcome =
  | { kind: "started"; session: WorkoutSessionRecord; autoClosedSession?: AutoClosedSessionNotice }
  | { kind: "resumed"; session: WorkoutSessionRecord }
  | { kind: "conflict"; /* …unchanged… */ }
  /**
   * 17d: a NEW session was requested against an archived plan. In-progress
   * sessions are unaffected — this variant is unreachable for them, because the
   * resume branches return before the archived check runs.
   */
  | { kind: "plan_archived" }
  /**
   * 17d: the plan is ready but does not contain the requested day — newly
   * reachable once a user can remove a day by editing. `availableDays` is
   * ascending, so the client can offer what remains instead of a bare 404.
   */
  | { kind: "day_not_in_plan"; availableDays: number[] };

export interface WorkoutPlanSummary {
  id: string;
  status: string;
  createdAt: string;
  name?: string;
  /** 17d. ISO-8601 instant, or null when the plan is active. */
  archivedAt?: string | null;
  /** 17d, `?progress=1` only. Absent when unknown — never 0. */
  daysPerWeek?: number;
  /** 17d, `?progress=1` only. */
  completedSessions?: number;
  /** 17d, `?progress=1` only. ISO-8601; absent when never trained. */
  lastTrainedAt?: string;
}
```

`contracts.test.ts:318-319` asserts `WorkoutPlanSummary` with `toEqualTypeOf<{…}>()`, which is
**exact** — PR A must update that assertion, and `:210-266` gains the two new
`StartSessionOutcome` variants. Every addition is type-only, so the ordered **runtime** export list
(`contracts.test.ts:61-72`) is unchanged; that test staying green is itself the proof.

```ts
// The edit request/response, and the archive response.
export interface UpdatePlanProgramRequest {
  program: WorkoutProgram;
  /** 17d, Judgment Day finding 1: the `updatedAt` the editor loaded — the optimistic-concurrency precondition. */
  expectedUpdatedAt: string;
}
export interface UpdatePlanProgramResponse { id: string; program: WorkoutProgram; updatedAt: string }
export interface PlanArchiveResponse { id: string; archivedAt: string | null }
/** 17d, Judgment Day finding 1: `expectedUpdatedAt` no longer matches — another edit landed first. */
export interface PlanEditConflictResponse { error: "edit_conflict"; currentUpdatedAt: string }
```

Route response for the mismatch case: `409 { error: "edit_conflict", currentUpdatedAt }`, distinct in
body shape from `409 { error: "plan_not_ready" }` so the client renders the correct message for each —
the losing writer is told which of the two 409s occurred, not left to guess.

## File changes

| File | Action | PR |
|---|---|---|
| `apps/api/src/db/repositories/workout-plan.ts` | Modify — `includeArchived` filter, `listPlansWithProgress`, `setArchived`, `updateProgram`, `archivedAt` on the summary | A, B, D |
| `apps/api/src/routes/plan.ts` | Modify — `?progress=1` + `?includeArchived=1` on `GET /workout-plans`; archive/unarchive routes; `PUT /workout-plans/:id/program`; port additions | A, B, D |
| `apps/api/src/app.ts` | Modify — adapter methods for the new repo calls | A, B, D |
| `apps/api/src/db/schema.ts` | Modify — `archivedAt` on `workoutPlans` | B |
| `apps/api/drizzle/0029_workout_plan_archived_at.sql` + journal `idx: 29` | Create | B |
| `apps/api/src/db/__tests__/migration-journal.test.ts` | Modify — one pinning assertion for `idx: 29` | B |
| `apps/api/src/db/repositories/workout-session.ts` | Modify — Phase 2 archived + day refusals; select `archivedAt` in `findReadyPlan` | B |
| `apps/api/src/routes/workout-session.ts` | Modify — 409 `plan_archived`, 404 `day_not_in_plan` | B |
| `packages/contracts/src/index.ts` | Modify — outcome variants, summary fields, edit/archive DTOs | A, B, D |
| `packages/contracts/src/contracts.test.ts` | Modify — exact-shape and union assertions | A, B, D |
| `packages/domain/src/plan/edited-program.ts` + `src/index.ts` | Create / modify — `validateEditedProgram` | D |
| `apps/web/src/app/(app)/plans/{page.tsx,actions.ts,plans-client.ts,PlanList.tsx,PlanRowActions.tsx}` | Create | A, B |
| `apps/web/src/app/(app)/plan/page.tsx` | Modify — distinguishable load-error state (`:36`) | A |
| `apps/web/src/app/(app)/plan/[id]/edit/{page.tsx,ProgramEditor.tsx,program-edit-client.ts,actions.ts}` | Create | D |
| `apps/web/src/app/(app)/plan/[id]/tracker/__tests__/tracker-model.invariant.test.ts` | Create | D |
| `apps/web/src/components/AppShell/{SidebarNav,MobileNav}.tsx` | Modify — one `NAV_ITEMS` entry, one `SECONDARY_TABS` entry | A |
| `apps/web/src/components/AppShell/__tests__/{SidebarNav,MobileNav}.test.tsx` | Modify — nav-shape assertions | A |
| `packages/i18n/src/messages/{en,es}.json` | Modify — `appNav.plans`, `plans.*`, `plan.nav.loadError.*`, `planEdit.*` | A, B, D |
| `apps/mobile/src/api/plan-status-client.ts` | Modify — `fetchPlanList`, `archivePlan`, `unarchivePlan` | C |
| `apps/mobile/src/screens/plans/{PlansScreen.tsx,PlansScreen.styles.ts,messages.ts}` | Create | C |
| `apps/mobile/App.tsx` | Modify — `Plans` route, `PROTECTED_ROUTES`, `<Stack.Screen>` | C |
| `apps/mobile/src/screens/HomeScreen.tsx` | Modify — one entry button | C |

**Nav test files:** the proposal flagged their assertions as unconfirmed. They exist —
`AppShell/__tests__/{SidebarNav,MobileNav}.test.tsx` (verified by listing); their contents were not
opened this phase, so PR A must read them before editing rather than assume the shape.

**i18n rebuild gotcha:** apps resolve `@kinora/i18n` through built `dist/`. Editing the catalogs
without rebuilding silently serves stale messages, on **both** web (`next-intl`) and mobile
(`resolveMessages` flattens the same `catalogs` for `react-intl` — `apps/mobile/src/i18n/locale.ts:27-29`).
Run `pnpm build` before manual verification.

**Mobile copy is reused, not re-authored.** `apps/mobile/src/screens/plans/messages.ts` is id-only
`defineMessages` pointing at the `plans.*` keys PRs A and B author on the web side — the convention
`screens/profile/messages.ts:1-12` documents. PR C adds **no** new catalog key, and must check for an
existing `plan.*` key before reaching for a new one.

## Testing strategy

Strict TDD: the failing test lands before the behaviour, in the same commit. Vitest 3.2.4;
`pnpm -r test`; coverage `pnpm -r --if-present test:coverage`, apps/api functions ≥85%, apps/web ≥90%,
enforced by `.githooks/pre-push`.

**The apps/api headroom is real: ~0.5 points (85.51% after #392).** Every new API function — six repo
methods and four route handlers — ships with its tests in the same commit. PR D's `validateEditedProgram`
lives in `packages/domain`, which falls under the **global functions threshold of 100** rather than
apps/api's 85: a domain function with one untested branch-function fails the gate outright, so its
test table must be exhaustive, not representative.

**The CI integration list is a glob (#392).** A new `*.integration.test.ts` under
`apps/api/src/db/repositories/__tests__/` is executed with no workflow edit, and the false-green guard
(`ci-cd.yml:136-144`) fails the job if a suite on disk was not invoked. No hand-edited list, unlike
17c.

| PR | Layer | What |
|---|---|---|
| A | Unit repo | `listPlansWithProgress`: **exactly three queries for N plans** (spy on the db, assert call count invariant to N — the anti-N+1 acceptance criterion); zero plans → one query; a plan with no sessions → `completedSessions: 0`, no `lastTrainedAt`; a missing spec row → `daysPerWeek` absent, not 0 |
| A | Unit route | `?progress=1` returns the extra fields; without it the response is byte-identical to today's |
| A | Unit web | `/plans` renders progress; **a failed list fetch renders the error state, not the empty state** — the same assertion for `plan/page.tsx` (`:36`) |
| A | Component web | Nav renders a `/plans` entry in the sidebar and in the More menu; the bar still renders exactly three primary tabs |
| B | Unit repo | `findAllByUser` hides archived by default and returns them with `includeArchived`; `setArchived` is idempotent (a second archive does not move the timestamp); a cross-user id resolves to `undefined` |
| B | Unit repo | `startSession` → `plan_archived` for a new session on an archived plan; **`resumed` for an in-progress session whose plan was archived mid-workout**; `day_not_in_plan` with ascending `availableDays` |
| B | Unit repo | `recordSet` / `completeSession` / `abandonSession` all succeed against an archived plan — the "does not stop someone mid-workout" criterion, asserted rather than argued |
| B | Integration `workout-plan-archive.integration.test.ts` | Archiving destroys **zero** `workout_sessions` rows (count before == count after); unarchive restores visibility exactly |
| B | Guard | `migration-journal.test.ts` — `0029_workout_plan_archived_at` at `idx: 29` |
| B | Unit route | 409 `plan_archived`; 404 `day_not_in_plan` carrying `availableDays`; archive/unarchive 200/404 |
| B | Repo-wide guard | **Widened (Judgment Day finding 2).** No `DELETE` route exists for plans, nor for `plan_specs` — assert the registered route table contains no `DELETE` on any `/workout-plans*` or `/plan-specs*` path. The assertion's own comment states the cascade chain (`plan_specs` → `workout_plans` → `workout_sessions` → `session_exercises` → `set_records`) so the reason travels with the guard, not just the assertion |
| C | Unit client | `fetchPlanList` / `archivePlan` / `unarchivePlan`: 401 sets `sessionExpired`, 404 carries `status`, no tenantId/userId in any request body |
| C | Component mobile | `PlansScreen` renders progress, archives a row and removes it from the list, load failure renders an error state |
| D | Unit domain | `validateEditedProgram`: zero sessions, duplicate day, day 0/8, an empty session, and a valid program returning `[]` — every branch |
| D | Unit route | **A submitted `catalogId` is absent from what reaches the repository**, and the server-resolved id is present instead; `limitationWarnings` from the body are ignored and the stored ones survive; 409 on a `generating` plan; 404 on another user's plan |
| D | Unit route | **New (Judgment Day finding 1).** A stale `expectedUpdatedAt` is rejected with `409 edit_conflict` carrying the plan's current `updatedAt`; a matching `expectedUpdatedAt` succeeds and the response's `updatedAt` advances past it |
| D | Integration `workout-plan-edit.integration.test.ts` | Edit-then-start reflects the edit in the new snapshot; removing a day makes that day's start return `day_not_in_plan`; editing during an active session leaves its `session_exercises`/`set_records` byte-identical |
| D | Guard web | `tracker-model.ts` contains no reference to the stored program |

## PR boundary and re-forecast

The proposal's four-PR chain survives, with **one re-seam** — stated because the brief asked me to say
so if the seams fall elsewhere.

**`day_not_in_plan` moves from PR D to PR B.** The proposal implies it lands with edit, since edit is
what makes a removed day reachable. But it is an edit to the *same fifteen lines* of `startSession`'s
Phase 2 that `plan_archived` rewrites, plus the same `StartSessionOutcome` union and the same route
handler. Splitting them means PR D rebases on PR B's version of a block it is about to change again,
and a reviewer reads the same code twice. It is also independently correct without edit: the bare 404
is reachable today through a data anomaly, and exploration says so. PR B ships both refusals; PR D
ships the integration test that proves the removed-day path end to end.

Everything else holds: A is the surface later slices attach to, B needs A's list to hide plans from,
C is scoped to exactly what A and B shipped and remains the cleanest trim candidate, D is last by
pinned decision 4 and on its merits.

| PR | Content | Non-test | Test |
|---|---|---|---|
| A | `/plans` route + nav (2 arrays, 2 catalogs) + `listPlansWithProgress` + `?progress=1` + the `plan/page.tsx:36` fix | ~250–400 | ~280–430 |
| B | Migration `0029`, filter, archive/unarchive routes, **both** `startSession` refusals, contract variants, show-archived UI | ~200–260 | ~230–340 |
| C | Mobile plans list + archive (screen, client methods, nav entry) | ~150–250 | ~150–250 |
| D | Edit: route + `validateEditedProgram` + editor UI + catalog reuse + tracker guard | ~270–410 | ~300–450 |
| | **Total** | **~870–1320** | **~960–1470** |

Every PR sits inside the 800-line non-test budget; the total remains 1.09–1.65× it, unchanged in
character from the proposal's honest signal. PR B grows ~50 lines and PR D shrinks ~40 relative to the
proposal, which is the re-seam and nothing else. Every figure is informed judgment from the shape of
the surrounding code, not measured from a diff.

## Migration / rollout

Deploy order is PR order. The one migration is additive and nullable, so it can be deployed before the
code that reads it; old code ignores a column it never selects.

- **PR D.** Revert the route, the client and the editor. Programs already edited stay edited — they are
  valid `WorkoutProgram` documents by construction (they passed `WorkoutProgramSchema` plus
  `validateEditedProgram`), so nothing is corrupted.
- **PR C.** Self-contained screen, client methods and nav entry; revert in isolation.
- **PR B.** Revert the code **before** dropping the column, or `findAllByUser` queries a column that no
  longer exists. After the drop every plan is visible again — the pre-change state exactly, with zero
  data loss, because archive never deleted anything. The `startSession` refusals revert with the code;
  an archived plan simply becomes startable again.
- **PR A.** Additive route and nav entry. **Keep the `plan/page.tsx:36` fix if the rest is reverted** —
  it is strictly a correctness improvement to an existing page.

## Open questions

- [ ] **`gh issue view 399` could not be run** — this phase had no shell. The issue's content is taken
      from `proposal.md`, `exploration.md` and Engram `#2697`. Apply should open the live issue and
      confirm nothing was added to it after the proposal was written.
- [x] **Index on `workout_sessions(tenant_id, user_id)` — confirmed, closed (Judgment Day finding 7).**
      It exists: `workout_sessions_tenant_user_idx` at `schema.ts:723-724`. Q3's tenant + user filter is
      already covered; no new index is needed for this change.
- [ ] **The nav test files were not opened.** `SidebarNav.test.tsx` / `MobileNav.test.tsx` exist; their
      exact assertions are unknown. PR A reads them before editing.
- [ ] **`?progress=1`'s effect on the trainer-facing plan reads was not traced.** `findLatestReadyByOwner`
      (`workout-plan.ts:221-238`) is a separate method and is untouched, but apply should confirm no
      trainer surface calls `findAllByUser` and would silently start hiding an archived client plan.
- [ ] **Zod's strip-by-default behaviour is relied on structurally** in step 2 of the edit path. It is
      the documented default for `z.object`, but apply should assert it in the first test written for
      that route rather than after the implementation — if the repo ever configures a global
      `passthrough`, the whole decision-5 guarantee changes shape.
