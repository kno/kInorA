# Design: 17b-stale-session-recovery

Implements the pinned decisions of `openspec/changes/17b-stale-session-recovery/proposal.md`
(1-10 + the resolved question round) over the evidence in `exploration.md`. This document owns the
HOW: the constant's home, the funnel predicate, the migration, the auto-close transaction, the
notice DTO, the guard placement, the client mechanism, and the PR seams. It does not restate the
product decisions and does not reopen them.

Every claim below marked **verified** was checked by opening the file named beside it during this
phase. Three of the proposal's working assumptions did not survive that check; they are called out
in **Corrections to the proposal** and the design absorbs them.

## Technical Approach

Four seams, no new architectural pattern:

1. **A shared abandonment module** (`apps/api/src/db/session-abandonment.ts`) owning the threshold
   constant AND the cutoff arithmetic, imported by both `admin-stats.ts` and `workout-session.ts`.
   The session repository stops being downstream of admin reporting; neither file computes
   `now - hours * HOUR_MS` itself.
2. **An authoritative `startSession` transaction.** The existing unlocked pre-read becomes a pure
   fast path; the branch decision is re-made under the user-row lock, and the auto-close UPDATE is
   predicated on `status = 'active' AND started_at < cutoff` rather than on the id read outside.
   The partial unique index frees the slot inside the same transaction (verified,
   `schema.ts:705-707`), so update-then-insert needs no index change.
3. **One `abandoned` write path, three triggers.** Auto-close (age), explicit Discard (scope A), and
   nothing else. Discard reaches it through a new named endpoint, never through a generic status
   PATCH.
4. **A two-arm funnel predicate** whose arms are disjoint on the `status` column alone, so
   mutual exclusivity is structural rather than argued.

Everything else is a consequence.

## Corrections to the proposal

| Proposal claim | Verified reality | Consequence for this design |
|---|---|---|
| Decision 8: "widening `WorkoutSessionRecordStatus` makes TypeScript flag the two `isCompleted` derivations — a useful forcing function" | **False.** Both sites are `session.status === "completed"` equality comparisons (`tracker-model.ts:116`, `tracker-logic.ts:249`). Widening a union does not error on `===`; there is no `switch`, no `never` check, no exhaustive consumer. Both compile silently and treat `abandoned` as "not completed", i.e. as live | The forcing function must be **built**, not inherited. See **Status derivation**. `apps/mobile` is the worse case: `isComplete = status === "completed" \|\| currentExercise === undefined`, so a fully-logged abandoned session reports `isComplete: true` |
| Decision 10: `getWeeklyOverview` / `getExerciseDetail` status filtering unverified | **Both are safe.** `getWeeklyOverview` filters `eq(workoutSessions.status, "completed")` at `workout-session.ts:1271`; `getExerciseDetail` filters the same at `workout-session.ts:1346` | Decision 10 is closed. No change to either. No further unverified consumer remains |
| Revised PR boundary: "PR 2 is pure client work over an API that PR 1 already settled" | Scope A's **Discard** has no API to call. `DELETE /workout-sessions/:id` deletes and is `completed`-only (`:501-537`); abandoning must preserve every set row | The abandon endpoint moves into PR 1. See **PR boundary**. PR 2 then really is client-only |

One more finding that shrinks scope rather than growing it: **neither history surface links into
the tracker.** Web `/history` renders plain `<li>` cards with no anchor (`history/page.tsx:53-89`);
mobile `HistoryScreen` renders non-pressable `<View>` cards (`HistoryScreen.tsx:62-94`). "Terminal
in the UI — no resume, no set logging, no completion" is therefore satisfied structurally by both
surfaces today; PR 3 adds a label and stops two derived numbers from lying, and removes nothing.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Threshold home (proposal decision 3) | `apps/api/src/db/session-abandonment.ts` — a shared module at the `db/` level, exporting `ABANDONED_SESSION_THRESHOLD_HOURS` and `abandonedSessionCutoff(now)`. Both repositories import it; `admin-stats.ts` re-exports the constant so `admin-stats.ts:415` keeps publishing `abandonedSessionThresholdHours` unchanged | A constant in `packages/domain` (root barrel or a new `./session` subpath) | **Every consumer is inside `apps/api`** — the two repositories, and nothing else; no client needs the number, because the banner only ever renders under the threshold. Crossing a package boundary for two same-app consumers buys nothing and costs three things: the `exports` map, `deps-guard`/Dockerfile bookkeeping, and — decisively — the **dist-staleness gotcha** (apps resolve workspace packages through built `dist/`, so an unrebuilt `packages/domain` silently serves the old value). A stale *statistics* constant is a wrong chart; a stale *behavioural* constant silently decides whether a user can train. Precedent for the placement: `apps/api/src/db/muscle-classifier.ts` and `apps/api/src/db/progress-domain.ts` already sit at `db/` for exactly the "several repositories need this" reason. Placing it at `db/repositories/` instead would make one repository look like a dependency of another |
| Cutoff arithmetic | Lives with the constant as `abandonedSessionCutoff(now: Date): Date`. Both call sites take the `Date` and never multiply hours themselves | Exporting only the number | The proposal pins "no second magic number". A shared constant with duplicated `now - HOURS * HOUR_MS` arithmetic in two files is a second magic number wearing a disguise — and the funnel and the write path disagreeing by an hour is exactly the class of bug that produces a double-count |
| Enum migration | `apps/api/drizzle/0026_workout_session_abandoned_enum.sql`, one statement: `ALTER TYPE "public"."workout_session_status" ADD VALUE IF NOT EXISTS 'abandoned';` plus a hand-added journal entry `idx: 26` | A `CHECK` constraint; recreating the type; folding a backfill into the same file | Byte-for-byte the shape `0018_gym_tier_enum.sql` used for `billing_tier`'s `'gym'` — which shipped to this production deployment and proves both that `ADD VALUE` survives Drizzle's per-file transaction here and that appending preserves existing ordinals. Add-only, so the "cannot use a new enum value in the transaction that adds it" trap cannot fire |
| Migration bookkeeping | Journal entry hand-added and asserted by a test; **no `meta/*_snapshot.json`** | Running `drizzle-kit generate` | `0025_drop_substitution_note` is the immediate precedent: hand-written SQL, journal entry, no snapshot (snapshots stop at `0024`). The journal `idx` — not the filename — is what `migrate` reads, and a missing entry makes it skip the file **silently on deploy**. This has bitten this repo before, so it gets an assertion, not a checklist item |
| Auto-close decision point | Inside the transaction, after the `FOR UPDATE` lock, re-reading the active row and re-deciding the branch. The UPDATE is scoped by `(tenantId, userId) AND status='active' AND started_at < cutoff`, **not** by the id read outside | Reusing the pre-transaction read's id; a compare-and-swap on `updated_at` | The pre-read at `:285` runs outside any lock. Under a double-tap, both requests see the same stale row; without a re-decision the second one abandons nothing (its cutoff no longer matches) and then violates the partial unique index on insert. Re-deciding under the lock turns the second tap into a clean `resumed`. The age-scoped predicate makes the write self-validating: a stale read can never abandon the wrong row |
| `completedAt` on auto-close | Stays `NULL` | Setting it to the close time | `completed_at` means "the user finished this workout". Writing it for an abandoned session is the same falsehood as writing `status='completed'`, one column over — and `getRetentionFunnel`'s `min()`/`array_agg()[2]` ordinals read that column. `updated_at` records when the transition happened |
| Discard transport | New `POST /workout-sessions/:id/abandon` → `abandonSession(tenantId, userId, id)` | `PATCH /workout-sessions/:id { status }`; reusing `DELETE` | A generic status PATCH is a loaded gun aimed at `completed`, which decision 1 exists to prevent. `DELETE` destroys the set rows the whole change exists to preserve. A named, single-purpose verb cannot be misused |
| Auto-close notice wire shape | The 200 body stays the session record, with one **additive optional sibling key**: `StartSessionResponse = WorkoutSessionRecord & { autoClosedSession?: AutoClosedSessionNotice }` | An envelope `{ session, autoClosedSession }` | The 200 body is parsed positionally as the record by web `/plan`, web `/plan/[id]` and mobile. An envelope is a coordinated breaking change across three clients for one optional field; an additive key is invisible to every existing parser and to the offline snapshot writer (`use-workout-session.ts:457`) |
| Contracts export tests | Unaffected — every new contracts symbol is a `type`/`interface` | — | `contracts.test.ts:61-72` asserts `Object.keys(contracts)`, i.e. **runtime** values only. `AutoClosedSessionNotice`, `StartSessionResponse` and the widened union are all erased at build. The proposal's decision-8 warning applies to runtime exports and does not bind here. `contracts.test.ts:160-189` **does** exercise `StartSessionOutcome` and must be extended |
| Status derivation on the clients | A local exhaustive `sessionLifecycle(status)` in each tracker module, with a `never` default | Relying on the widening to break the build (it does not); a shared runtime helper in contracts | Builds the forcing function the proposal assumed it was inheriting, and makes the *next* status value a compile error rather than another silent mislabel. Kept local because a runtime export in `packages/contracts` would break `contracts.test.ts:61-72` for a three-line function |
| Focus management scope | Web `/plan` only | All three clients | Mobile's conflict is a **full-screen replacement**, not a banner (`WorkoutTrackerScreen.tsx:871-894`) — there is nothing to scroll to. `/plan/[id]` renders the banner as the first node of the returned fragment (`PlanStatusClient.tsx:187-193`), already above the fold. `/plan` is the one surface where the banner lives in the week-board panel while the Hero CTA lives elsewhere, which is the reported "every button appeared dead" |
| History query | Extend `listCompletedSessions` in place (widened status filter, `coalesce` ordering, completed-only trend chain) and rename to `listSessionHistory` | A second endpoint/query for abandoned rows merged client-side | Two paginated lists merged in the client is a correctness problem (page boundaries) for no gain. One query keeps the existing bounded 3-query shape and the existing `+1` lookback |

## The retention-funnel predicate

The pinned counting contract is `abandoned` OR (`active` AND older than the threshold). The exact
predicate replacing `admin-stats.ts:386-396`:

```ts
const [abandoned] = await this.db
  .select({ total: sql<number>`count(*)::int` })
  .from(workoutSessions)
  .innerJoin(users, eq(users.id, workoutSessions.userId))
  .where(
    and(
      gte(workoutSessions.startedAt, windowStart),
      or(
        // Arm 1 — the stored fact. Deliberately NOT age-filtered: an
        // explicitly discarded session is abandoned whatever its age.
        eq(workoutSessions.status, "abandoned"),
        // Arm 2 — the legacy inference, for rows decision 5 never touches.
        and(
          eq(workoutSessions.status, "active"),
          lt(workoutSessions.startedAt, abandonedBefore),
        ),
      ),
    ),
  );
```

`or` must be added to the `drizzle-orm` import at `admin-stats.ts:1`.

**Why no row can satisfy both arms.** `status` is a single non-null column with exactly one value
per row. Arm 1 requires `status = 'abandoned'`; arm 2 requires `status = 'active'`. The arms are
disjoint on that column alone, independent of age, of `windowStart`, and of write timing. Nothing
about the predicate needs to be reasoned about temporally — which is the point, because the
transition period is precisely when temporal reasoning fails.

Three properties this buys, in the proposal's own terms:

- **No undercount.** Pre-existing aged `active` rows (decision 5: no backfill) still count, via arm 2.
- **No overcount.** A row converted by auto-close leaves arm 2 in the same statement that puts it
  in arm 1. There is no instant at which it is in both, and no instant at which it is in neither.
- **Convergence.** As the population turns over, arm 2 empties and the metric becomes the stored
  fact with no further change.

**The age filter is deliberately absent from arm 1.** Adding `lt(startedAt, abandonedBefore)` there
would preserve today's wording but silently drop every session a user discarded explicitly under 24
hours — sessions that are abandoned by the clearest possible evidence, the user saying so. Arm 1
reads the fact; only arm 2 infers, and only inference needs an age test.

`windowStart` is retained on both arms so the metric stays inside the reporting window — unchanged
behaviour. `abandonedBefore` is now `abandonedSessionCutoff(now)` from the shared module.

## The auto-close transaction

`startSession` restructures into three phases. Phase 1 and 2 are unlocked reads; phase 3 is the
only place a decision becomes binding.

```
startSession(tenantId, userId, workoutPlanId, day, now = new Date()):

  ── Phase 1 — unlocked fast path (unchanged semantics) ──────────────────
  existing = findLatestActiveSession(tenantId, userId)          # this.db
  if existing and existing matches (workoutPlanId, day):
      return resumed(findById(...))                             # Branch A, unchanged
  if existing and existing.startedAt >= cutoff:
      return conflict(activePlanId, activePlanName,
                      activeDay, activeStartedAt)               # Branch B, under-threshold
                                                                # (+ two new fields)

  ── Phase 2 — validate the TARGET before abandoning anything ────────────
  plan = findReadyPlan(...);        if !plan?.programJson: return undefined
  plannedSession = plan.programJson.weeklySessions.find(day);
                                    if !plannedSession:    return undefined

  ── Phase 3 — authoritative, locked ────────────────────────────────────
  return db.transaction(tx => {
      SELECT users.id WHERE id = userId FOR UPDATE               # existing lock, :327-331

      current = findLatestActiveSession(tenantId, userId, tx)    # re-read UNDER the lock
      if current:
          if current matches (workoutPlanId, day): return resumed(...)
          if current.startedAt >= cutoff:          return conflict(...)

          autoClosed = UPDATE workout_sessions
                         SET status = 'abandoned', updated_at = now
                       WHERE tenant_id = :t AND user_id = :u
                         AND status = 'active'
                         AND started_at < :cutoff
                    RETURNING id, started_at                     # completed_at untouched (NULL)

      INSERT workout_sessions (... status='active', day) RETURNING *
      insertSessionExercises(tx, ...)                            # unchanged
      insertSetRecords(tx, ...)                                  # unchanged
      return { kind: "started", session, autoClosedSession? }
  })
```

**Phase 2 must precede phase 3.** Validating the target plan and day before entering the
transaction means a start that would 404 never abandons anything. Abandoning a session and then
returning `undefined` would destroy the user's ability to resume it for a request that failed —
the exact "something happened to my data and nothing said so" complaint this change exists to end.

**How it composes with the existing lock.** The `FOR UPDATE` on the user row (`:327-331`) is the
first statement in the transaction and already serializes session creation against
`deleteAllByUser` (`:551-556`). Making it also the gate for the re-read means the re-read, the
UPDATE and the INSERT are one serialized unit per user. Walking the double-tap:

| | Tap 1 | Tap 2 |
|---|---|---|
| Phase 1 | sees stale row S (5 days old) | sees the same stale row S |
| Phase 3, lock | acquires | **blocks** |
| re-read | S, stale → proceed | (waiting) |
| UPDATE | S → `abandoned`, 1 row | (waiting) |
| INSERT | new row N, `active` | (waiting) |
| commit / lock | releases | acquires |
| re-read | — | **N**, started seconds ago |
| branch | — | N matches `(planId, day)` → `resumed`, no write |

The second tap returns the session the first one created, which is the correct answer, and never
reaches the INSERT that would violate `workout_sessions_single_active_per_user_unique`. Without the
in-transaction re-read, tap 2's age-scoped UPDATE would match zero rows and its INSERT would raise
a unique violation — a 500 on a double-tap. The re-read is not defensive polish; it is what makes
the age-scoped predicate safe.

**Why the UPDATE is scoped by age, not by `current.id`.** The two are equivalent under the lock, but
the age-scoped form stays correct if the lock is ever weakened or the re-read ever drifts: it can
only ever transition a row that is genuinely active and genuinely stale. Its `RETURNING` clause is
also the notice's only source, so a zero-row UPDATE yields no notice by construction — the notice
cannot claim a close that did not happen.

**Signature changes.**

- `startSession(..., now: Date = new Date())` — an optional trailing `now`, matching the repo's own
  precedent at `getWeeklyOverview(tenantId, userId, weekStart, now = new Date())` (`:1256-1261`).
  This is what makes the age branch testable without clock manipulation. The route does not pass it.
- `findLatestActiveSession(tenantId, userId, executor: Executor = this.db)` — accepts the
  transaction handle. Stays `private`; unchanged for the phase-1 caller.

## The four guards

All four stances are pinned; this fixes where each check lives and what it returns.

| Guard | Where the check goes | Mechanism | Shape on `abandoned` |
|---|---|---|---|
| `findLatestActiveSession` (`:1416-1434`) | **No change** | `eq(status, "active")` already excludes it | Row is invisible; the conflict check sees the slot as free. Falls out for free, as pinned |
| `recordSet` (`:387-397`) | **No change to the code**, one new test | `if (!session \|\| session.status !== "active") return undefined` already rejects anything non-active | `undefined` → route maps to `404 not_found` (`routes/workout-session.ts:216-219`), unchanged contract. A test asserts it explicitly so the behaviour is pinned rather than incidental |
| `completeSession` (`:453-480`) | **One added branch** | The `WHERE status='active'` UPDATE already affects 0 rows. The recovery re-read then checks `existing?.status === "completed"`, which is false for `abandoned`, so it falls through to `undefined` — already correct, but by accident | Keep the fall-through, add an explicit `if (existing?.status === "abandoned") return undefined;` with a comment naming decision 1. Result is unchanged (`404`); the point is that a future edit to the recovery block cannot silently start completing abandoned sessions |
| `deleteById` (`:501-537`) | **One changed line** | The delete's `eq(status, "completed")` must widen to `inArray(status, ["completed", "abandoned"])` | Deletes. The disambiguating re-read at `:533` keeps `row.status === "active"` → `active_conflict`, so only a genuinely in-progress session is protected |
| `deleteAllByUser` (`:547-586`) | **One changed line** | Same widening on the bulk delete at `:579`. The `active`-only guard read at `:565` is unchanged | Deletes. Without this, a user who is auto-closed twice accumulates two permanently undeletable rows — one operational dead end swapped for another, which decision 4 explicitly forbids |

## Status derivation on the clients

The widening does not break the build (see **Corrections**). Both derivations gain an explicit
three-way mapping with a `never` default, so the *next* status value is a compile error:

```ts
// apps/web/src/app/(app)/plan/[id]/tracker/tracker-model.ts
// apps/mobile/src/screens/tracker/tracker-logic.ts
type SessionLifecycle = "live" | "completed" | "abandoned";

function sessionLifecycle(status: WorkoutSessionRecordStatus): SessionLifecycle {
  switch (status) {
    case "active":    return "live";
    case "completed": return "completed";
    case "abandoned": return "abandoned";
    default: {
      const exhaustive: never = status;
      throw new Error(`unhandled session status: ${String(exhaustive)}`);
    }
  }
}
```

Intended branch per site:

| Site | Today | After |
|---|---|---|
| `tracker-model.ts:116` — `isCompleted = status === "completed"` | `abandoned` → `false` (renders as live) | `isCompleted = lifecycle === "completed"`, plus a new `isTerminal = lifecycle !== "live"` that the panel uses to suppress set inputs and the complete CTA |
| `tracker-logic.ts:249` — `isComplete = status === "completed" \|\| currentExercise === undefined` | **Worse:** a fully-logged abandoned session reports `isComplete: true` — it claims a completion that never happened | `isComplete = lifecycle === "completed"`; the `currentExercise === undefined` clause applies only when `lifecycle === "live"`. `isTerminal` added the same way |

This matters beyond cosmetics because `findById` has **no status filter** (`:354-363`), so a
bookmarked or stale tracker URL can still load an abandoned session. `recordSet` will reject the
writes, but without `isTerminal` the UI would present live controls that silently fail — the same
"button appeared dead" class of defect the change is fixing. `isTerminal` therefore ships with the
contracts widening in PR 1, not later.

## Interfaces / Contracts

```ts
// apps/api/src/db/session-abandonment.ts  — NEW
/**
 * How long a workout session may sit in `status = 'active'` before it is
 * treated as abandoned. Behavioural since 17b: past this age a start request
 * auto-closes the blocking session instead of returning a conflict.
 */
export const ABANDONED_SESSION_THRESHOLD_HOURS = 24;
/** The instant before which an `active` session is considered abandoned. */
export function abandonedSessionCutoff(now: Date): Date;

// packages/contracts/src/index.ts  — widened + additive (all type-only)
export type WorkoutSessionRecordStatus = "active" | "completed" | "abandoned";

/** A stale session auto-closed while starting a new one (17b). */
export interface AutoClosedSessionNotice {
  id: string;
  /** ISO-8601 instant the auto-closed session started — the date shown to the user. */
  startedAt: string;
}

export type StartSessionOutcome =
  | { kind: "started"; session: WorkoutSessionRecord; autoClosedSession?: AutoClosedSessionNotice }
  | { kind: "resumed"; session: WorkoutSessionRecord }
  | {
      kind: "conflict";
      activePlanId: string;
      activePlanName?: string;
      activeDay: number | null;
      /** 17b scope A: the blocking session, so the banner can name its date and resume it. */
      activeSessionId: string;
      activeStartedAt: string;
    };

/** 200 body of POST /workout-sessions. Additive: existing parsers are unaffected. */
export type StartSessionResponse = WorkoutSessionRecord & {
  autoClosedSession?: AutoClosedSessionNotice;
};

/** Result of POST /workout-sessions/:id/abandon (17b scope A Discard). */
export type AbandonSessionOutcome =
  | { kind: "abandoned"; session: WorkoutSessionRecord }
  | { kind: "not_active" }
  | { kind: "not_found" };
```

The `started | resumed` arm is **split**, not merely extended, so `autoClosedSession` cannot appear
on a resume — a resume closes nothing. The split is source-compatible with every existing consumer:
`routes/workout-session.ts:151-160` narrows on `kind === "conflict"` and then reads
`outcome.session`, which both remaining arms still carry.

### Route surface

| Route | Change |
|---|---|
| `POST /workout-sessions` (`routes/workout-session.ts:134-162`) | 200 body becomes `{ ...outcome.session, ...(outcome.kind === "started" && outcome.autoClosedSession ? { autoClosedSession: outcome.autoClosedSession } : {}) }`. The 409 body gains `activeSessionId` and `activeStartedAt`. Both additive |
| `POST /workout-sessions/:id/abandon` | **New.** `preHandler: requireAuth()`. `abandoned` → `200` with the session record; `not_active` → `409 { error: "session_not_active" }`; `not_found` → `404 { error: "not_found" }` |

`abandonSession` mirrors `completeSession`'s idempotency discipline exactly: a guarded
`UPDATE ... WHERE (tenantId, userId, id) AND status='active'`; on 0 rows a **scoped** re-read
(never an unscoped `WHERE id =` — the IDOR class documented at `:444-451`) that returns `abandoned`
as a 200 no-op, `completed` as `not_active`, and nothing as `not_found`.

## Scope A — the actionable banner

The banner already renders (`DayDetailPanel.tsx:129-133`, `PlanStatusClient.tsx:189-193`, mobile
`WorkoutTrackerScreen.tsx:871-894`). Three defects, three fixes.

**1. The date.** `activeStartedAt` reaches the client through the widened conflict DTO and
`WorkoutSessionConflict` (`use-workout-session.ts:85-89`, set at `:441-445`). The three existing
message keys gain a `{date}` argument rather than three new keys being added beside them — every
call site is updated in the same commit, so an in-place message change is the smaller diff and
avoids a stale parallel set. Formatting is ICU `{date, date, medium}` in both apps (next-intl on
web, react-intl on mobile), so the locale does the work and no date string is built by hand.

**2. Resume and Discard.**

- *Resume* calls `handleStartWorkout(conflict.activePlanId, conflict.activeDay)` — the existing
  action, which hits Branch A and returns `resumed`. No new endpoint. When `activeDay` is `null`
  (a legacy row) Branch A cannot match, so Resume instead navigates to the tracker by
  `conflict.activeSessionId`; this is the only reason the id is on the DTO.
- *Discard* opens a confirmation step (pinned: one confirm), then `POST .../abandon`, then retries
  the original start. A failed abandon surfaces `plan.start.discardFailed` and does **not** retry —
  the one thing worse than a blocked start is a blocked start that silently did nothing.

**3. Focus — web `/plan` only.** The fix is moving focus, not rendering harder. The banner becomes
a focusable container:

```tsx
<div ref={bannerRef} tabIndex={-1} role="alert" data-testid="start-conflict">
```

with an effect that runs when `conflict` transitions from absent to present:

```ts
useEffect(() => {
  if (!conflict) return;
  bannerRef.current?.focus();
  bannerRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
}, [conflict]);
```

`tabIndex={-1}` makes it programmatically focusable without inserting it into the tab order.
`role="alert"` is retained so screen readers announce it regardless; the focus move is what fixes
the sighted-user case where the banner rendered in the week-board panel while the user was looking
at the Hero CTA. `scrollIntoView` follows focus rather than replacing it — focus alone already
scrolls in most browsers, but the explicit call centres the banner rather than leaving it at the
viewport edge. The effect depends on `conflict` identity, so a repeated failed start re-announces
and re-focuses.

`conflict` currently lives in `use-workout-session.ts` and is passed into `DayDetailPanel` as a
prop; the ref and effect live in `DayDetailPanel` because that is where the node is. No state moves.

**The auto-close notice** is the mirror image and deliberately *not* an alert:
`role="status"` (polite), non-blocking, rendered beside the newly started session, reading
"We closed your unfinished session from {date}." It never takes focus — the user asked to start a
workout and got one; interrupting them would be the wrong trade.

## Read-only abandoned history (PR 3)

`listCompletedSessions` → `listSessionHistory`, three changes inside the existing bounded 3-query
shape:

1. Status filter widens: `inArray(workoutSessions.status, ["completed", "abandoned"])`.
2. Ordering becomes `desc(sql\`coalesce(${workoutSessions.completedAt}, ${workoutSessions.startedAt})\`)`.
   **This is load-bearing.** Abandoned rows have `completed_at IS NULL`, and Postgres sorts NULLs
   **first** under `ORDER BY ... DESC` — leaving the ordering alone would float every abandoned
   session to the top of history forever.
3. Trend pairs completed-with-completed only. The existing pairwise walk (`:676-681`) runs over the
   completed-only subsequence, and results are attached back by session id; abandoned entries get
   `trend: undefined` and are never a baseline. Otherwise a session holding 1 of 15 sets would
   report every subsequent workout as a huge volume gain.

`totalVolume` and `averageRpe` are still computed for abandoned entries — they are truthful
statements about the sets that were logged, which is the whole reason the rows are preserved.

No contract change: `WorkoutHistoryEntry.session.status` already carries the value once the union
widens. Both clients branch on it:

| Surface | Change |
|---|---|
| `apps/web/src/app/(app)/history/page.tsx` | Render a `history.abandoned` label when `status === "abandoned"`; suppress the duration line (`sessionDurationMinutes` already returns `undefined` with no `completedAt`, so this is a no-op safeguard). No link exists to remove |
| `apps/mobile/src/screens/HistoryScreen.tsx` | Same label; same already-safe duration. Cards are non-pressable `<View>`s, so no navigation to remove |

"Terminal" is enforced server-side by the guards, not by hiding buttons: even a hand-crafted
request to `recordSet` or `completeSession` is rejected.

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/db/session-abandonment.ts` | Create | `ABANDONED_SESSION_THRESHOLD_HOURS`, `abandonedSessionCutoff(now)` + the rationale comment relocated from `admin-stats.ts:34-49` |
| `apps/api/src/db/schema.ts` | Modify | `workoutSessionStatusEnum` gains `"abandoned"` **last** (`:669-672`); update the comment at `:666-668` |
| `apps/api/drizzle/0026_workout_session_abandoned_enum.sql` | Create | One `ALTER TYPE ... ADD VALUE IF NOT EXISTS` statement, add-only |
| `apps/api/drizzle/meta/_journal.json` | Modify | Hand-add `{ idx: 26, version: "7", when: <ms>, tag: "0026_workout_session_abandoned_enum", breakpoints: true }` |
| `apps/api/src/db/repositories/admin-stats.ts` | Modify | Import + re-export the constant from the shared module (delete the local definition at `:50`); add `or` to the drizzle import; rewrite the abandoned sub-query (`:386-396`) |
| `apps/api/src/db/repositories/workout-session.ts` | Modify | `startSession` three-phase restructure + optional `now`; `findLatestActiveSession` gains an executor arg; `abandonSession` added; explicit `abandoned` branch in `completeSession`; delete predicates widened in `deleteById` / `deleteAllByUser`; `listCompletedSessions` → `listSessionHistory` |
| `apps/api/src/routes/workout-session.ts` | Modify | Additive 200/409 fields on `POST /workout-sessions`; new `POST /workout-sessions/:id/abandon`; history route calls the renamed method |
| `packages/contracts/src/index.ts` | Modify | Widen the union; `AutoClosedSessionNotice`, `StartSessionResponse`, `AbandonSessionOutcome`; split the `started`/`resumed` arm; widen `conflict` |
| `apps/web/src/app/(app)/plan/[id]/tracker/tracker-model.ts` | Modify | `sessionLifecycle` + `isTerminal` |
| `apps/mobile/src/screens/tracker/tracker-logic.ts` | Modify | `sessionLifecycle` + `isTerminal`; fix `isComplete` |
| `apps/web/src/app/(app)/plan/use-workout-session.ts` | Modify | `WorkoutSessionConflict` gains `activeSessionId` / `activeStartedAt`; `autoCloseNotice` state; `handleDiscardSession` |
| `apps/web/src/app/(app)/plan/DayDetailPanel.tsx` | Modify | Banner ref + focus/scroll effect; Resume / Discard + confirm; `{date}` |
| `apps/web/src/app/(app)/plan/[id]/PlanStatusClient.tsx` | Modify | Resume / Discard + confirm; `{date}` (no focus work — already top-of-fragment) |
| `apps/web/src/app/(app)/plan/[id]/actions.ts` | Modify | Thread the widened conflict fields + `autoClosedSession`; add the abandon action |
| `apps/mobile/src/screens/WorkoutTrackerScreen.tsx` | Modify | Resume / Discard + confirm on the existing full-screen conflict state; `{date}` |
| `apps/mobile/src/api/workout-session.ts` | Modify | Abandon client call; thread the widened fields |
| `apps/web/src/app/(app)/history/page.tsx`, `apps/mobile/src/screens/HistoryScreen.tsx` | Modify | Abandoned label (PR 3) |
| `packages/i18n/src/messages/{en,es}.json` | Modify | See below |

### i18n keys

`plan.start.conflict`, `conflict_no_day`, `conflict_generic` (`en.json:315-317`, `es.json:315-317`)
gain a `{date}` argument in place. New: `plan.start.autoClosed`, `plan.start.resume`,
`plan.start.discard`, `plan.start.discardConfirm`, `plan.start.discardConfirmYes`,
`plan.start.discardCancel`, `plan.start.discardFailed`, `history.abandoned`. Both locales, neutral
professional Spanish.

**Rebuild gotcha:** apps resolve `@kinora/i18n` through built `dist/`. An i18n edit without a
package rebuild serves stale messages and — because a message that lost its `{date}` argument still
renders — fails as a missing date rather than a crash. `pnpm build` (or root `pnpm dev`, which
prebuilds packages) before manual verification.

## Testing Strategy

Strict TDD: the failing test lands before the behaviour, in the same commit. Runner Vitest 3.2.4;
`pnpm -r test`; coverage `pnpm -r --if-present test:coverage` with apps/api functions ≥85% and
apps/web ≥90%, enforced by `.githooks/pre-push`.

| PR | Layer | What | Approach |
|---|---|---|---|
| 1 | Unit `__tests__/session-abandonment.test.ts` | `abandonedSessionCutoff` is exactly 24h before `now`; the constant is 24 | Pure. Cheap function coverage, which helps the thin apps/api headroom |
| 1 | Guard `__tests__/migration-journal.test.ts` | Every `apps/api/drizzle/*.sql` filename has a matching `tag` in `_journal.json`, and `idx` values are contiguous from 0 | Reads both from disk. **This is the assertion that replaces the hand-check** — the trap is silent skipping on deploy, so it must fail in CI, not in a reviewer's memory |
| 1 | Integration `admin-stats.integration.test.ts` (extends `:50, 461, 478`) | **Mixed-population fixture**, the highest-risk test in the change: (a) stored `abandoned`, aged; (b) stored `abandoned`, 1h old — must still count, proving arm 1 is not age-filtered; (c) untouched `active`, aged — arm 2; (d) `active`, 1h old — neither arm; (e) `completed`, aged — neither arm; (f) `abandoned` outside `windowStart` — excluded. Assert the total equals exactly `\|{a,b,c}\|`, and that no fixture is counted twice by also asserting the sum of two single-arm queries equals the two-arm total | Real Postgres, as the existing suite already does |
| 1 | Integration `startSession` auto-close | Aged active + start another day → `kind: "started"`, old row `status='abandoned'`, `completed_at` still `NULL`, **every `session_exercises` and `set_records` row still present** (count before/after); `autoClosedSession.startedAt` equals the old row's; a direct assertion that no auto-close ever writes `completed` | Injected `now`, no clock mocking |
| 1 | Integration under-threshold | 23h-old active + start another day → `kind: "conflict"` with `activeSessionId` / `activeStartedAt`, and the old row is **untouched** | Injected `now` |
| 1 | Integration double-tap | Two concurrent `startSession` calls against the same aged row → one `started`, one `resumed`, exactly one `active` row afterwards, **no unique-violation error**. Also: the 404 path (unknown day) leaves the stale row `active` | `Promise.all` over two calls on the same pool |
| 1 | Integration guards | `recordSet` on an abandoned session → `undefined`; `completeSession` → `undefined` and the row stays `abandoned`; `deleteById` → `deleted`; `deleteAllByUser` deletes abandoned alongside completed and still returns `active_conflict` when a live session exists | Real Postgres |
| 1 | Unit `abandonSession` | active → `abandoned`; already abandoned → 200 no-op; completed → `not_active`; other tenant/user → `not_found` (indistinguishable from nonexistent) | Real Postgres |
| 1 | Unit route | 200 carries `autoClosedSession` only on `started`; 409 carries the two new fields; abandon route status mapping | Existing Fastify `app.inject` harness |
| 1 | Unit `contracts.test.ts` | Extend `:160-189` for the split arm + widened conflict; assert the runtime export list at `:61-72` is **unchanged** (proving the additions are type-only) | `expectTypeOf` |
| 1 | Unit tracker derivations | `sessionLifecycle` maps all three; mobile `isComplete` is `false` for a fully-logged abandoned session (the current-behaviour regression); `isTerminal` is `true` for completed and abandoned, `false` for active | Pure, both apps |
| 2 | Component web `/plan` | Conflict → banner receives focus (`document.activeElement`), message contains the formatted date, Resume calls start with `(activePlanId, activeDay)`, Discard shows a confirm and only then posts abandon, cancel posts nothing, abandon failure shows `discardFailed` and does not retry the start | RTL + jsdom (`scrollIntoView` stubbed — jsdom does not implement it) |
| 2 | Component web `/plan/[id]` + mobile | Same actions and confirm; no focus assertion (out of scope by design) | RTL / RN testing library |
| 2 | Component auto-close notice | `role="status"`, names the date, does **not** steal focus | RTL |
| 3 | Integration `listSessionHistory` | Abandoned entries appear; ordering is by `coalesce(completed_at, started_at)` so an abandoned session does not jump to the top; abandoned entries carry `trend: undefined` and are excluded from the completed trend chain; `totalVolume` reflects the logged sets | Real Postgres, mixed fixture |
| 3 | Component both history surfaces | Abandoned label renders; no duration line; nothing navigable is introduced | RTL / RN testing library |

## PR boundary

The proposal's three-PR split is right in shape and has one seam in the wrong place. Validated
against the mechanism above:

| PR | Content | Estimate |
|---|---|---|
| 1 | C + B + **the abandon endpoint** + the two tracker derivations: shared constant module, enum migration + journal, contracts widening, funnel rewrite, the four guards, the three-phase `startSession`, `abandonSession` + route, notice payload, `sessionLifecycle`/`isTerminal` | ~350–620 |
| 2 | A — client only: Resume, Discard + confirm, start date, `/plan` focus, notice UI, i18n | ~150–300 |
| 3 | History — `listSessionHistory` + the label on both surfaces | ~80–160 |

Two corrections to the boundary, both moving work **into** PR 1:

- **`abandonSession` + its route belong in PR 1.** Discard has no API today: `DELETE` deletes and is
  `completed`-only. Leaving the endpoint in PR 2 makes PR 2 a mixed server+client PR and leaves PR 1
  shipping a write path with only one of its two triggers. It is the same UPDATE, the same guards
  and the same tests as auto-close; splitting it costs a second review of the same reasoning.
- **The two tracker derivations belong in PR 1.** They ship with the contracts widening, because PR 1
  is what makes `abandoned` reachable, and `findById` has no status filter — without `isTerminal`,
  PR 1 alone would let a stale tracker URL render live controls over a terminal session, and would
  let mobile report a fully-logged abandoned session as complete.

PR 3 shrinks below the proposal's `~100–200` because neither history surface links into the tracker,
so nothing has to be removed to make the record terminal.

PR 1's upper estimate approaches the 800-line budget without exceeding it. If review measures it
over, the seam is already present in the code: **1a** = the migration, the shared constant, the
contracts widening, the funnel rewrite and the four guards (a read-and-schema PR that changes no
write path); **1b** = the three-phase `startSession`, `abandonSession` and the notice payload. 1a
alone is inert — nothing writes `abandoned` until 1b — so it is safe to land and revert
independently.

## Migration / Rollout

Deploy order is PR order; nothing is coupled across a deploy boundary. The migration is add-only, so
the enum value exists before any code writes it, and the old code ignores a value it never produces.

Rollback follows the proposal: PR 3 and PR 2 revert cleanly in isolation. PR 1's `abandoned` value is
forward-only — exactly like `billing_tier`'s `'gym'` — but the funnel query reverts independently of
the enum, and reverting to arm 2 alone still counts every session, only less precisely. Any rows
already written `abandoned` stay valid and readable; they simply stop being produced.

## Open Questions

- [ ] `/plan/[id]/tracker`'s entry point was not opened this phase. `findById` has no status filter
      (verified, `:354-363`), so an abandoned session **can** be loaded there; `isTerminal` covers the
      rendering, but apply must confirm whether the route itself should 404 or render the terminal
      view. Rendering it read-only is the better answer — a 404 for a session the user can see in
      history would be its own dead end — but the code path needs opening before that is asserted.
- [ ] The three existing conflict messages gain `{date}` in place. Apply must confirm no other call
      site formats those keys (grep at design time found only `DayDetailPanel.tsx:94-102`,
      `PlanStatusClient.tsx:176-185` and the mobile `M.conflict*` definitions), because a missed call
      site renders a message with an unresolved argument rather than failing loudly.
- [ ] `admin-stats.ts` re-exporting `ABANDONED_SESSION_THRESHOLD_HOURS` preserves every existing
      importer, including the integration test at `:50`. Apply should decide whether to keep the
      re-export permanently or migrate the test's import and drop it; the design assumes it stays,
      as the smaller diff.
