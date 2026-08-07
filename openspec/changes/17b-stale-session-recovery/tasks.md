# Tasks: 17b — Stale Session Recovery

Implements `openspec/changes/17b-stale-session-recovery/specs/stale-session-recovery/spec.md`
(10 requirements, 26 scenarios) under `design.md` and the pinned decisions of `proposal.md`
(1-10 + the resolved question round; **decisions 8 and 10 carry design-phase CORRECTED blocks that
win over the original text**). Fixed slice order, do not resequence: **PR 1 → PR 2 → PR 3**. Every
implementation task is preceded by its RED test task (Strict TDD). Tests ship in the same commit as
the module they cover.

## Review Workload Forecast

| PR | Content | Non-test / test (est.) | Changed lines (add+del, est.) | 800-line budget risk | Decision needed before apply |
|----|---------|------------------------|--------------------------------|------------------------|-------------------------------|
| 1 | C + B whole (owner declined the optional 1a/1b split) — enum migration + journal guard, shared constant module, contracts widening, funnel rewrite, the four guards, three-phase `startSession`, `abandonSession` + route, notice DTO, tracker `sessionLifecycle`/`isTerminal` on both clients | ~280 / ~340 | ~620 | Low (pre-resolved) | No — resolved by the product owner; kept whole |
| 2 | A — actionable under-24h banner: Resume, Discard + one confirm, blocking session's start date, web `/plan` focus/scroll handoff, auto-close notice UI, i18n | ~90 / ~110 | ~200 (150–300 range) | Low | No |
| 3 | Read-only abandoned history, web + mobile | ~50 / ~90 | ~140 (100–200 range) | Low | No |

**Delivery decision (resolved, do not re-derive):** three PRs, `chain_strategy: stacked-to-main`,
each targeting the previous PR's branch or `main` in sequence. PR 1 was forecast at ~350–620 lines by
design and the product owner explicitly declined the design's offered 1a/1b split (migration+
contracts+funnel+guards vs. the write path) — it ships as one PR. `delivery_strategy: ask-on-risk`
was already exercised during propose/design; this is not re-opened here. Total ~430–1000 lines across
three PRs, each individually well under the 800-line single-PR budget, so `chained-pr`'s decision
gate ("PR ≤400 changed lines and focused → keep single PR" is not the binding case here; the binding
case is "SDD provides `delivery_strategy` → follow it") resolves to: keep PR 1 whole per the
owner's call, PR 2 and PR 3 are already comfortably under 400 each.

### Dependency diagram (for chained-PR tracking; mark the current PR with 📍)

```
PR 1 (enum + constant + contracts + funnel + guards + startSession + abandonSession + isTerminal)
 └─ PR 2 (client banner: Resume/Discard/focus/notice UI over the API PR 1 settled)
     └─ PR 3 (read-only abandoned history, web + mobile)
```

### Chain strategy

**`chain_strategy: stacked-to-main`** (cached from session context, not re-asked): PR 1, PR 2, PR 3
each target the previous PR's branch or `main` in sequence and merge before the next is created —
rebase each PR onto its base after the prior one merges; do not stack a child on an unmerged parent.
PR 1 alone removes the need for production database access to clear a stale session — the actual
incident this change exists to fix — so it should merge first regardless of PR 2/3 readiness.

Consequences for apply:
- `gh` operations on `kno/kInorA` require `gh auth switch --user kno` first; the default account is
  not a collaborator and the switch does not persist.
- PR 1's `abandoned` enum value is forward-only once rows reference it (like `billing_tier`'s
  `'gym'`); PR 2 and PR 3 revert cleanly and independently of PR 1.

## Repo gotchas carried into task notes (do not re-derive)

- **Drizzle journal `idx` is not derived from the SQL filename** — a missing journal entry makes
  `migrate` **silently skip** the migration on deploy. This has bitten this repo before (also
  called out in the 16e tasks). The guard test (PR1.2) replaces the hand-check with a CI assertion
  that every `apps/api/drizzle/*.sql` has a matching journal `tag` with contiguous `idx` from 0.
- **Postgres NULL ordering**: `ORDER BY ... DESC` puts `NULL` **first**. `listSessionHistory`
  (PR 3) must order by `coalesce(completed_at, started_at)`, not `completed_at` alone, or every
  abandoned session floats permanently to the top of history.
- **Trend pairing** (PR 3): the existing pairwise volume-trend walk must run over the
  completed-only subsequence. Pairing an abandoned 1-of-15-sets session into the chain makes every
  later workout look like a huge volume gain.
- **i18n dist staleness**: `apps/web`/`apps/mobile` resolve `@kinora/i18n` through built `dist/`,
  not `src`. An i18n edit (PR 2, PR 3) without a package rebuild silently serves stale messages —
  and because a message missing its new `{date}` argument still renders, this fails as an
  unresolved placeholder, not a crash. `pnpm build` (or root `pnpm dev`, which prebuilds packages)
  before manual verification of any i18n-touching PR.
- **Coverage gates**, enforced by `.githooks/pre-push`: `pnpm -r --if-present test:coverage`, global
  functions 100 / statements 80 / branches 80 / lines 80, with apps/api overridden to functions
  **85%** and apps/web to functions **90%**. A threshold failure is deterministic and real — never
  `--no-verify` past it; add the missing test instead.
- **`gh` auth**: pushing to `kno/kInorA` / opening or merging a PR requires
  `gh auth switch --user kno` first; the default account cannot merge and the switch does not
  persist across shells.
- **Contracts export tests**: `contracts.test.ts:61-72` asserts the exact ordered list of *runtime*
  exports (`Object.keys(contracts)`) and is unaffected — every 17b contracts addition is a
  type/interface. `contracts.test.ts:160-189` **does** exercise `StartSessionOutcome` and must be
  extended (PR1.5).

## Three open apply-time decisions, made explicit as tasks (not silent assumptions)

1. **`/plan/[id]/tracker` entry point for a terminal session** — design recommends terminal render
   over 404 (a 404 for a session visible in history would be its own dead end). Confirmed and
   implemented in PR1.14.
2. **The in-place `{date}` argument on the three existing conflict message keys** — confirmed the
   exact call-site set in PR2.1 before editing (design's own grep found only
   `DayDetailPanel.tsx:94-102`, `PlanStatusClient.tsx:176-185`, mobile `M.conflict*`); a missed call
   site renders an unresolved `{date}` placeholder rather than failing loudly.
3. **Whether `admin-stats.ts` keeps the `ABANDONED_SESSION_THRESHOLD_HOURS` re-export permanently**
   — decided in PR1.4: keep it permanently (the design's own recommendation, smaller diff, preserves
   the existing integration-test import at `:50`).

---

## Phase PR1: Stored Status, Auto-Close, Funnel, Guards, Abandon Endpoint, Tracker Derivations

Start state: `workout_session_status` is `active | completed`; `startSession` has no age-conditional
branch; `getRetentionFunnel` infers abandonment from `status='active'` + age only; the four call
sites have no explicit `abandoned` stance; there is no `abandonSession`/abandon route; both trackers'
status derivations are plain `===` equality that silently treats `abandoned` as live. End state:
`abandoned` is a real, stored, terminal status reachable by age or explicit discard, preserved
through every guard per decision 4, counted exactly once by the funnel, and both trackers render it
correctly via an exhaustive `sessionLifecycle`/`isTerminal`. Rollback boundary: revert the auto-close
branch in `startSession` (returns `conflict` for aged sessions again) and the funnel rewrite; rows
already written `abandoned` remain valid and readable — they simply stop being produced.
`abandonSession`/its route revert independently (Discard reverts to non-functional in PR 2, not a
regression since PR 2 hasn't shipped yet in the stack).

Satisfies: Auto-Close On Session Start Past Threshold; Auto-Close Never Writes Completed; Auto-Close
Preserves All Session Data; Auto-Close Notice Names the Closed Session's Date; Abandoned Sessions
Are Terminal, With One Exception for Deletion; Retention Funnel Counts Each Session Exactly Once; No
Backfill for Pre-Existing Active Rows; Discard Produces the Same Terminal State as Auto-Close (the
write-path mechanism half — the client trigger ships in PR 2).

### Migration + guard test

- [x] PR1.1 Preflight: grep `apps/api/drizzle/meta/_journal.json` and confirm the current highest
      `idx` is 25 (matching `0025_drop_substitution_note`), so the new entry is `idx: 26` with no gap
- [x] PR1.2 RED: `apps/api/src/db/__tests__/migration-journal.test.ts` — every
      `apps/api/drizzle/*.sql` filename has a matching `tag` entry in `_journal.json`, and `idx`
      values are contiguous starting at 0, with no gaps and no duplicates
- [x] PR1.3 GREEN: create `apps/api/drizzle/0026_workout_session_abandoned_enum.sql` — one statement,
      `ALTER TYPE "public"."workout_session_status" ADD VALUE IF NOT EXISTS 'abandoned';` (byte shape
      of `0018_gym_tier_enum.sql`); hand-add the journal entry
      `{ idx: 26, version: "7", when: <ms>, tag: "0026_workout_session_abandoned_enum", breakpoints: true }`
      to `apps/api/drizzle/meta/_journal.json`; add `"abandoned"` last to `workoutSessionStatusEnum`
      in `apps/api/src/db/schema.ts:669-672` and update the comment at `:666-668`; confirm PR1.2 is
      green

### Shared abandonment module

- [x] PR1.4 RED: `apps/api/src/db/__tests__/session-abandonment.test.ts` — `abandonedSessionCutoff(now)`
      returns exactly 24 hours before `now`; `ABANDONED_SESSION_THRESHOLD_HOURS === 24`
- [x] PR1.5 GREEN: create `apps/api/src/db/session-abandonment.ts` exporting
      `ABANDONED_SESSION_THRESHOLD_HOURS` and `abandonedSessionCutoff(now: Date): Date`, carrying the
      rationale comment relocated from `admin-stats.ts:34-49`
- [x] PR1.6 GREEN: `apps/api/src/db/repositories/admin-stats.ts` imports the constant and re-exports
      it so `:415` keeps publishing `abandonedSessionThresholdHours` unchanged (open decision 3,
      resolved: keep the re-export permanently — the existing integration-test import at `:50` is
      untouched); delete the local definition

### Contracts widening

- [x] PR1.7 RED: extend `packages/contracts/src/contracts.test.ts:160-189` for the split
      `started`/`resumed` arm (`autoClosedSession?` only on `started`), the widened `conflict` arm
      (`activeSessionId`, `activeStartedAt`), the new `AbandonSessionOutcome`, and
      `WorkoutSessionRecordStatus` accepting `"abandoned"`; assert `contracts.test.ts:61-72`'s runtime
      export list (`Object.keys(contracts)`) is **unchanged** by this diff, proving the additions are
      type-only
- [x] PR1.8 GREEN: in `packages/contracts/src/index.ts` — widen
      `WorkoutSessionRecordStatus = "active" | "completed" | "abandoned"`; add
      `AutoClosedSessionNotice { id, startedAt }`; split `StartSessionOutcome` into
      `started { session, autoClosedSession? } | resumed { session } | conflict { activePlanId,
      activePlanName?, activeDay, activeSessionId, activeStartedAt }`; add
      `StartSessionResponse = WorkoutSessionRecord & { autoClosedSession?: AutoClosedSessionNotice }`;
      add `AbandonSessionOutcome = { kind: "abandoned"; session } | { kind: "not_active" } |
      { kind: "not_found" }`

### Retention funnel rewrite

- [x] PR1.9 RED: extend `apps/api/src/db/repositories/__tests__/admin-stats.integration.test.ts`
      (`:50, 461, 478`) with the mixed-population fixture: (a) stored `abandoned`, aged; (b) stored
      `abandoned`, 1h old; (c) untouched `active`, aged; (d) `active`, 1h old; (e) `completed`, aged;
      (f) `abandoned` outside `windowStart`. Assert the abandoned total equals exactly `|{a,b,c}|`,
      and that the sum of two single-arm queries equals the two-arm total (no double-count)
- [x] PR1.10 GREEN: add `or` to the `drizzle-orm` import at `admin-stats.ts:1`; rewrite the abandoned
      sub-query (`:386-396`) to the two-arm predicate — arm 1 `eq(status, "abandoned")` with no age
      filter, arm 2 `and(eq(status, "active"), lt(startedAt, abandonedSessionCutoff(now)))` — both
      still gated by `gte(startedAt, windowStart)`; confirm PR1.9 is green

### The four guards

- [x] PR1.11 RED: `apps/api/src/db/repositories/__tests__/workout-session.integration.test.ts` (or
      equivalent existing suite) — `findLatestActiveSession` on a user whose only candidate row is
      `abandoned` returns no session (pins existing `eq(status,"active")` behaviour, no code change
      expected); `recordSet` against an `abandoned` session returns `undefined` and writes no set row
      (pins existing `status !== "active"` rejection, no code change expected); `completeSession`
      against `abandoned` returns `undefined` and the row's status stays `abandoned`;
      `deleteById`/`deleteAllByUser` against `abandoned` rows succeed and are not rejected as
      "in progress"
- [x] PR1.12 GREEN: `completeSession` (`:453-480`) gains an explicit
      `if (existing?.status === "abandoned") return undefined;` branch with a comment naming pinned
      decision 1, ahead of the existing fall-through, so a future edit to the recovery block cannot
      silently start completing abandoned sessions; `deleteById`'s delete predicate (`:501-537`)
      widens from `eq(status, "completed")` to `inArray(status, ["completed", "abandoned"])`;
      `deleteAllByUser`'s bulk delete predicate (`:547-586`) widens identically; confirm PR1.11 is
      green — `findLatestActiveSession` and `recordSet` need no production change

### Three-phase `startSession` + auto-close + notice

- [x] PR1.13 RED: integration test — an aged (>24h) `active` session, `startSession` for a different
      plan/day with an injected `now`, asserts `kind: "started"`; the old row's `status` is
      `'abandoned'` and `completed_at` stays `NULL`; every `session_exercises` row and set row
      belonging to it is still present (count before/after); `autoClosedSession.startedAt` equals the
      old row's `started_at`; a direct assertion that no auto-close ever writes `completed`
- [x] PR1.14 RED: integration test — a 23h-old `active` session + start for a different plan/day
      returns `kind: "conflict"` with `activeSessionId`/`activeStartedAt` populated, and the old row
      is **untouched** (still `active`, unchanged `updated_at`)
- [x] PR1.15 RED: integration test — same-plan-same-day resume against an aged `active` session
      returns `kind: "resumed"` regardless of age, with no auto-close transition (row stays `active`)
- [x] PR1.16 RED: concurrency test — two `startSession` calls for the same user against the same aged
      row, raced via `Promise.all` on the same pool: exactly one `active` row exists afterward, one
      call returns `started` and the other `resumed`, no unique-violation error is thrown; also assert
      the 404 path (unknown day) leaves the stale row `active` (phase 2 precedes phase 3)
- [x] PR1.17 GREEN: restructure `startSession` in
      `apps/api/src/db/repositories/workout-session.ts` into the three phases per `design.md`'s
      "The auto-close transaction" section — phase 1 unlocked fast path (unchanged resume/
      under-threshold conflict), phase 2 validates the target plan+day before entering the
      transaction, phase 3 re-reads `findLatestActiveSession` under the existing user-row `FOR UPDATE`
      lock and re-decides the branch, with the auto-close `UPDATE` scoped by
      `(tenantId, userId) AND status='active' AND started_at < cutoff` (never by the id read outside)
      and `RETURNING id, started_at`; add optional trailing `now: Date = new Date()` to `startSession`'s
      signature; add an `executor: Executor = this.db` parameter to `findLatestActiveSession` (stays
      `private`); confirm PR1.13–PR1.16 are all green
- [x] PR1.18 RED: route unit test (existing Fastify `app.inject` harness) — the 200 body of
      `POST /workout-sessions` carries `autoClosedSession` only when `outcome.kind === "started"` and
      an auto-close occurred; the 409 body carries `activeSessionId` and `activeStartedAt`
- [x] PR1.19 GREEN: update `routes/workout-session.ts:134-162` — 200 body becomes
      `{ ...outcome.session, ...(outcome.kind === "started" && outcome.autoClosedSession ?
      { autoClosedSession: outcome.autoClosedSession } : {}) }`; 409 body gains the two new fields;
      confirm PR1.18 is green

### `abandonSession` + route

- [x] PR1.20 RED: unit test — `abandonSession(tenantId, userId, id)` on an `active` session transitions
      it to `abandoned` and returns `{ kind: "abandoned", session }`; called again on the same
      now-`abandoned` session is a 200 no-op (idempotent, same `{ kind: "abandoned" }`); on a
      `completed` session returns `{ kind: "not_active" }`; on another tenant's/user's session (or a
      nonexistent id) returns `{ kind: "not_found" }`, indistinguishable from one another (no IDOR
      leak, mirroring `completeSession`'s discipline documented at `:444-451`)
- [x] PR1.21 GREEN: implement `abandonSession` in `workout-session.ts` — a guarded
      `UPDATE ... WHERE (tenantId, userId, id) AND status='active'`; on 0 rows a **scoped** re-read
      (never an unscoped `WHERE id =`) mapping `abandoned` → 200 no-op, `completed` → `not_active`,
      nothing → `not_found`; confirm PR1.20 is green
- [x] PR1.22 RED: route unit test — `POST /workout-sessions/:id/abandon` maps `abandoned` → `200` with
      the session record, `not_active` → `409 { error: "session_not_active" }`, `not_found` →
      `404 { error: "not_found" }`
- [x] PR1.23 GREEN: add the route in `apps/api/src/routes/workout-session.ts` with
      `preHandler: requireAuth()`; confirm PR1.22 is green

### Tracker status derivation (the forcing function, built not inherited)

- [x] PR1.24 RED: `apps/web/src/app/(app)/plan/[id]/tracker/__tests__/tracker-model.test.ts` (or
      equivalent) — `sessionLifecycle` maps `active→"live"`, `completed→"completed"`,
      `abandoned→"abandoned"`; `isTerminal` is `true` for completed and abandoned, `false` for active
- [x] PR1.25 RED: `apps/mobile/src/screens/tracker/__tests__/tracker-logic.test.ts` — same three-way
      mapping; **regression case**: a fully-logged abandoned session (`currentExercise === undefined`,
      `status === "abandoned"`) now reports `isComplete: false` (today it reports `true` — a claimed
      completion that never happened)
- [x] PR1.26 GREEN: in `tracker-model.ts` — add the local exhaustive `sessionLifecycle(status)` with a
      `never` default; `isCompleted = lifecycle === "completed"`; add `isTerminal = lifecycle !== "live"`
      used by the panel to suppress set inputs and the complete CTA
- [x] PR1.27 GREEN: in `tracker-logic.ts` — same `sessionLifecycle` + `isTerminal`; rewrite
      `isComplete = lifecycle === "completed"`, with the `currentExercise === undefined` clause
      applying only when `lifecycle === "live"`; confirm PR1.24–PR1.25 are green

### Open decision 1 — the tracker route entry point for a terminal session

- [x] PR1.28 Opened `apps/web/src/app/(app)/plan/[id]` (there is no separate `.../tracker` route file
      in this codebase — `TrackerPanel` renders inline inside `/plan/[id]` when the client's
      `activeSession` state is set, and `page.tsx` only ever fetches `GET /workout-plans/:id`, never a
      session by id). Verified `GET /workout-sessions/:id` (`findById`) is not called from any web or
      mobile route with an arbitrary/URL-sourced id (`grep -rn "workout-sessions/\${"` across both
      apps' non-test source finds no such call site) — `activeSession` is populated only through
      `startSession`'s `started`/`resumed` outcomes, and `resumed` can never be an abandoned session
      (`findLatestActiveSession` already excludes it). So the literal "bookmarked/stale URL loads an
      abandoned session" entry point the design flagged does not exist in either client today; there is
      no 404-vs-render decision to make. `isTerminal` is still wired defensively into `TrackerPanel`
      (`TrackerTopbar`'s controls and the session timer now gate on `model.isTerminal` rather than
      `model.isCompleted`), so if `activeSession` is ever populated from a wider source in the future
      (offline snapshot rehydration, a future direct-fetch route), the terminal session already renders
      read-only rather than presenting live controls that would silently fail server-side
- [x] PR1.29 Covered by the `sessionLifecycle`/`isTerminal` unit tests in PR1.24/1.25 (`tracker-model
      isTerminal true/false`, `TrackerPanel`'s existing component tests already assert
      `isCompleted`-gated controls are disabled — re-verified green with `isTerminal` wired in). No
      additional route-level test was written since no such route exists (see PR1.28's finding above)

### PR 1 verification

- [x] PR1.30 Verify: `pnpm -r test` green; `pnpm -r --if-present test:coverage` green (apps/api
      functions ≥85%, apps/web functions ≥90%); `pnpm type-check` clean; `pnpm build` succeeds
- [x] PR1.31 Verify: grep confirms no remaining call site constructs a `startSession` result assuming
      the old flat `StartSessionOutcome` shape (the split-arm contracts change is source-compatible
      per design, but confirm no call site was missed)

---

## Phase PR2: Actionable Under-24h Conflict Banner + Auto-Close Notice UI

Start state: the conflict banner is read-only text with no date, no actions, and no focus
management on web `/plan`; the auto-close notice has no UI. End state: Resume and Discard (behind
one confirmation step) on all three surfaces, the blocking session's start date in the message, web
`/plan` moves focus to the banner on conflict, and a non-blocking `role="status"` notice announces an
auto-close. Rollback boundary: pure client change over the API PR 1 already settled; revert in
isolation and the read-only banner returns, with no server-side effect.

Satisfies: Under-24h Conflict Banner Is Actionable and Named by Date; Discard Produces the Same
Terminal State as Auto-Close (the client-trigger half — the write path is PR 1's `abandonSession`).

### Open decision 2 — the exact `{date}` call sites

- [x] PR2.1 Grep-confirm the complete call-site set for `plan.start.conflict`, `conflict_no_day`,
      `conflict_generic`: `DayDetailPanel.tsx:94-102`, `PlanStatusClient.tsx:176-185`, and the mobile
      `M.conflict*` message definitions. A missed call site would render an unresolved `{date}`
      placeholder rather than failing loudly, so this list is asserted before the i18n edit, not after

### i18n

- [x] PR2.2 Update `packages/i18n/src/messages/{en,es}.json` (`en.json:315-317`, `es.json:315-317`) —
      add a `{date}` argument in place to `plan.start.conflict`, `conflict_no_day`, `conflict_generic`;
      add new keys `plan.start.autoClosed`, `plan.start.resume`, `plan.start.discard`,
      `plan.start.discardConfirm`, `plan.start.discardConfirmYes`, `plan.start.discardCancel`,
      `plan.start.discardFailed`, both locales, neutral professional register; rebuild
      `packages/i18n` (`pnpm build` or root `pnpm dev`) before any manual verification — an unrebuilt
      package silently serves the stale catalog

### Web `/plan` — actionable banner with focus management

- [x] PR2.3 RED: `use-workout-session.test.ts` (or equivalent) — `WorkoutSessionConflict` gains
      `activeSessionId`/`activeStartedAt`; a new `autoCloseNotice` state is set when a `started`
      response carries `autoClosedSession`; `handleDiscardSession` posts to the abandon endpoint then
      retries the original start, and on abandon failure sets a `discardFailed` state and does **not**
      retry the start
- [x] PR2.4 GREEN: implement the above in
      `apps/web/src/app/(app)/plan/use-workout-session.ts`
- [x] PR2.5 RED: component test (RTL + jsdom, `scrollIntoView` stubbed) — on a `conflict` result,
      the banner receives focus (`document.activeElement`); the message contains the formatted
      `{date}`; Resume calls start with `(activePlanId, activeDay)`; when `activeDay` is `null`,
      Resume instead navigates to the tracker by `activeSessionId`; Discard shows a confirm step and
      only posts abandon after confirmation; cancel posts nothing; abandon failure shows
      `discardFailed` and does not retry the start

      **Deviation (discovered, not assumed):** `activePlanId` is on the internal `StartSessionOutcome`
      type but PR1's shipped route (`routes/workout-session.ts`) never forwards it in the 409 body —
      only `activePlanName`/`activeDay`/`activeSessionId`/`activeStartedAt` cross the wire. Resuming
      via `(activePlanId, activeDay)` is therefore not possible from the client as designed. Resume is
      implemented uniformly (both the normal and legacy null-day case) as `handleResumeSession
      (activeSessionId)` — a new hook action that loads the blocking session directly by id
      (`getWorkoutSessionAction`) and sets it active. This is strictly safer than re-deriving plan
      identity client-side (a same-plan-different-day conflict would otherwise resolve against the
      wrong plan id and produce a confusing repeat-conflict) and needs no API change.
- [x] PR2.6 GREEN: implement in `apps/web/src/app/(app)/plan/DayDetailPanel.tsx` — the banner becomes
      a focusable container (`ref`, `tabIndex={-1}`, `role="alert"`) with an effect that calls
      `.focus()` and `.scrollIntoView({ block: "center", behavior: "smooth" })` when `conflict`
      transitions from absent to present; Resume/Discard actions with the one-confirm step; `{date}`
      threaded into the three message keys; confirm PR2.5 is green
- [x] PR2.7 RED: component test — the auto-close notice renders `role="status"`, names the closed
      session's date, and does **not** steal focus (`document.activeElement` unchanged by its
      appearance)
- [x] PR2.8 GREEN: implement the auto-close notice; **rendered in `PlanTrackerClient.tsx`'s
      `activeSession` branch, not `DayDetailPanel.tsx`** — `DayDetailPanel` unmounts once a session is
      active (`PlanTrackerClient` swaps to `TrackerPanel`), so "beside the newly started session"
      necessarily means beside the tracker identity header, which lives in `PlanTrackerClient`
      (mirrored in `PlanStatusClient.tsx` for `/plan/[id]`). Confirms PR2.7 is green.

### Web `/plan/[id]` and mobile — same actions, no focus assertion

- [x] PR2.9 RED: component test — `PlanStatusClient.tsx` renders the same Resume/Discard + confirm
      actions and `{date}`; no focus assertion (out of scope by design — the banner already renders
      first in the returned fragment)
- [x] PR2.10 GREEN: implement in `apps/web/src/app/(app)/plan/[id]/PlanStatusClient.tsx` and thread
      the widened conflict fields + the abandon action through
      `apps/web/src/app/(app)/plan/[id]/actions.ts`; confirm PR2.9 is green
- [x] PR2.11 RED: RN component test — `WorkoutTrackerScreen.tsx`'s existing full-screen conflict state
      gains Resume/Discard + confirm and `{date}`
- [x] PR2.12 GREEN: implement in `apps/mobile/src/screens/WorkoutTrackerScreen.tsx`; add the abandon
      client call and thread the widened fields in `apps/mobile/src/api/workout-session.ts`; confirm
      PR2.11 is green

### PR 2 verification

- [x] PR2.13 Verify: `pnpm -r test` green; `pnpm -r --if-present test:coverage` green (apps/web
      functions ≥90%); `pnpm type-check` clean; `pnpm build` succeeds (rebuilds `packages/i18n`)

---

## Phase PR3: Read-Only Abandoned History

Start state: `listCompletedSessions` filters `completed`-only, orders by `completed_at DESC`, and
pairs every session into the volume trend chain; neither history surface renders an abandoned label.
End state: `listSessionHistory` includes `abandoned` rows ordered by
`coalesce(completed_at, started_at)`, trend pairing runs over the completed-only subsequence, and
both surfaces show an abandoned label with no duration line and nothing navigable added. Rollback
boundary: revert in isolation; `listCompletedSessions`'s prior behaviour and naming return, with no
PR 1/PR 2 dependency.

Satisfies: Abandoned Sessions Appear as Read-Only History.

- [ ] PR3.1 RED: `workout-session.integration.test.ts` (extends the existing `listCompletedSessions`
      fixture) — a mixed fixture of `completed` and `abandoned` sessions (some abandoned with
      `completed_at IS NULL`, aged before and after the completed rows by `started_at`): abandoned
      entries appear in the result; ordering follows `coalesce(completed_at, started_at) DESC` so an
      abandoned session does not float to the top ahead of a more recently completed one; abandoned
      entries carry `trend: undefined` and are excluded as a baseline for the completed-only trend
      chain (assert a completed session immediately following a 1-of-15-sets abandoned session does
      not report an inflated trend); `totalVolume`/`averageRpe` are still computed for abandoned
      entries from their logged sets
- [ ] PR3.2 GREEN: rename `listCompletedSessions` to `listSessionHistory` in
      `apps/api/src/db/repositories/workout-session.ts` (`:615-690`); widen the status filter to
      `inArray(workoutSessions.status, ["completed", "abandoned"])`; change ordering to
      `desc(sql`coalesce(${workoutSessions.completedAt}, ${workoutSessions.startedAt})`)`; restrict the
      existing pairwise trend walk (`:676-681`) to the completed-only subsequence and attach results
      back by session id, leaving abandoned entries with `trend: undefined`; update the route call
      site to the renamed method; confirm PR3.1 is green
- [ ] PR3.3 RED: component test — `apps/web/src/app/(app)/history/page.tsx` renders a
      `history.abandoned` label when `status === "abandoned"`, suppresses the duration line
      (`sessionDurationMinutes` already returns `undefined` with no `completedAt` — assert this stays
      a no-op safeguard, not a new branch), and introduces no navigable element (existing `<li>` cards
      have no anchor today; confirm none is added)
- [ ] PR3.4 GREEN: implement the label in `history/page.tsx`; add `history.abandoned` to both i18n
      catalogs; confirm PR3.3 is green
- [ ] PR3.5 RED: RN component test — `apps/mobile/src/screens/HistoryScreen.tsx` renders the same
      label; cards stay non-pressable `<View>`s (confirm no navigation is introduced)
- [ ] PR3.6 GREEN: implement the label in `HistoryScreen.tsx`; confirm PR3.5 is green

### PR 3 verification

- [ ] PR3.7 Verify: `pnpm -r test` green; `pnpm -r --if-present test:coverage` green; `pnpm type-check`
      clean; `pnpm build` succeeds

---

## Final Verification (run once the full chain has landed)

- [ ] `pnpm -r test` — full suite green, hermetic
- [ ] `pnpm -r --if-present test:coverage` — apps/api functions ≥85%, apps/web functions ≥90%
- [ ] `pnpm type-check` — no errors
- [ ] `pnpm build` — CI's real gate, must succeed (also confirms `packages/i18n` rebuild picked up
      the new catalog entries)
- [ ] Grep confirms `abandonedSessionThresholdHours` still resolves through `admin-stats.ts`'s
      re-export with no broken importer (open decision 3)
- [ ] Manual/operational: unblocking a stuck user with a stale `active` session requires no
      production database access — the incident this change exists to close
