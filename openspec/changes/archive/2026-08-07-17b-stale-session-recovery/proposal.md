# Proposal: 17b-stale-session-recovery (a stale session must never require production database access)

GitHub [kno/kInorA#367](https://github.com/kno/kInorA/issues/367). Real implementation. Builds on
`openspec/changes/17b-stale-session-recovery/exploration.md` — do not re-derive its evidence.

The three product forks the exploration surfaced were decided by the product owner on 2026-08-07 and are
pinned below as constraints, not options: **B = auto-close**, **C = stored `abandoned` status**,
**D = separate follow-up issue**.

## Intent

A user had one `active` workout session from five days earlier. Every "Start session" press returned
`409 active_session_conflict`, and the only way to unblock production was to delete the row by hand with
direct database access. That is the operational answer today, and it must stop being the answer.

The author explicitly refused to mark that session `completed` while unblocking, because it was not
completed — it held 1 of 15 sets. Recording that falsehood would have injected a fake completion into the
#353 retention funnel. **That refusal is the design centre of this change**: the system needs a third,
truthful terminal state so that unblocking a user never requires lying about what happened.

Success: a session older than 24 hours never blocks a new workout; it is closed as `abandoned`, not
`completed`; no logged set data is deleted; the retention funnel reads the stored fact instead of guessing;
and a genuinely in-progress session from earlier the same day gives the user a visible resume-or-discard
choice instead of a read-only banner.

### Correction to the issue's premise (verified, carried from exploration)

The issue states the `conflict` value is threaded but "never rendered to a conclusion". **The second half
is false.** `setConflict` is called (`use-workout-session.ts:441-445`) and a localized `role="alert"`
`data-testid="start-conflict"` banner renders at `DayDetailPanel.tsx:129-133`, with equivalents at
`PlanStatusClient.tsx:174-193` and mobile `WorkoutTrackerScreen.tsx:871-885`. Scope A is therefore
narrower and different from the issue's framing — see below.

## Scope

### In Scope

- **B. Auto-close on start.** When `startSession` finds a blocking active session whose age exceeds
  `ABANDONED_SESSION_THRESHOLD_HOURS` (24), it transitions that session to `abandoned` inside the same
  transaction that creates the new one, then proceeds to the normal `started` branch. Under the threshold,
  the existing `conflict` branch is unchanged.
- **C. Stored `abandoned` status.** Widen `workout_session_status` from `active | completed` to
  `active | completed | abandoned`: Postgres enum migration, `packages/contracts` DTO widening, and the
  write path from B.
- **C. Retention-funnel rewrite.** `getRetentionFunnel` (`admin-stats.ts:304`) stops inferring abandonment
  from `status = 'active'` + age and reads the stored value, with an explicit stated position on
  pre-existing rows.
- **C. Call-site stance.** An explicit, tested decision for each of the four guards that currently treat
  `status = 'active'` as "the one blocking, resumable session": `completeSession` (`:453-480`),
  `deleteById` / `deleteAllByUser` (`:501-586`), `recordSet` (`:387-397`),
  `findLatestActiveSession` (`:~1416-1427`).
- **A. Actionable conflict banner, for the under-24h case only.** Resume and discard actions on the banner;
  the blocking session's **start date** in the message; co-location with (or scroll/focus handoff to) the
  CTA that triggered the conflict on `/plan`. Applied to web `/plan`, web `/plan/[id]` and mobile.
- **Auto-close notice.** The start response carries enough information for the client to tell the user a
  stale session was closed on their behalf, naming its date. See resolved question 1.
- **Read-only abandoned-session history.** Abandoned sessions appear in the user's session history with
  their logged sets, terminal — no resume, no new sets, no completion. Web and mobile. See resolved
  question 2. This does **not** relax pinned decision 4.
- i18n catalog entries for every new string; tests shipped in the same commit as each behaviour change.

### Out of Scope

- **D. The swallowed-error audit.** Split out as its own issue — see "Follow-up work". Not in this change's
  scope and not in its review budget.
- Any automatic background sweep, cron, or job that abandons sessions without a user action. The transition
  is on-start only.
- Enriching the bare `409` shape on `DELETE /workout-sessions/:id` and `DELETE /workout-sessions`
  (`workout-session.ts:260-261, 279-280`). Verified to have **zero client callers**; nothing is being
  swallowed there. Leave it.
- Making the 24-hour threshold user-configurable or admin-tunable.
- Backfilling historical rows (see decision 5).
- Any change to plan generation, the tracker's set-logging model, or billing.

## Capabilities

### New Capabilities

- `stale-session-recovery`: a workout session that has been abandoned is recorded as such and stops blocking
  the user, with no data loss and no false completion.

### Modified Capabilities

- `startSession` gains an age-conditional auto-close branch before the conflict branch.
- Admin retention statistics read a stored abandonment fact instead of inferring one.
- The start-conflict banner becomes an actionable recovery affordance.

## Approach & Pinned Decisions

**1. Auto-close writes `abandoned`, never `completed` — this is the whole change.** `completed` is a claim
about the user's behaviour; `abandoned` is a claim about the session's fate. Writing `completed` would
inflate the #353 completion metric with workouts nobody finished, which is precisely what the incident
responder refused to do by hand. `abandoned` also keeps every `session_exercises` and set row intact: the
transition is a status update, never a delete, so the 1-of-15 sets in the incident would have survived.

**2. The existing partial unique index makes auto-close mechanically clean — verified.**
`workout_sessions_single_active_per_user_unique` is `uniqueIndex(tenantId, userId) WHERE status = 'active'`
(`apps/api/src/db/schema.ts:705-707`). Writing `abandoned` therefore drops the old row out of the index and
frees the slot for the new insert *within the same transaction*, with no index change and no widening of the
single-active-session invariant. The user-row lock in `startSession`'s transaction
(`workout-session.ts:325-346`) already serializes concurrent starts, so the update-then-insert pair is safe
under a double-tap. The invariant is preserved, not relaxed.

**3. `ABANDONED_SESSION_THRESHOLD_HOURS` changes role and should change home.** It lives in
`admin-stats.ts:50` and is an informational statistics cutoff today. Scope B promotes it to a *behavioural*
cutoff that decides whether a user can train. Importing an admin-stats constant into the core session
repository is a layering smell and would make an admin-reporting file load-bearing for the workout path.
**Position: relocate it to a shared, non-admin home and have both `admin-stats.ts` and the session
repository import it from there.** The exact home (a domain constant in `packages/domain`, or an
`apps/api/src/db/repositories` shared module) is left to `sdd-design`. What is pinned: one constant, one
definition, no second magic number, and the session repository must not depend on `admin-stats.ts`.
`admin-stats.ts:415` continues to expose it as `abandonedSessionThresholdHours`.

**4. `abandoned` is terminal — with one deliberate exception.** A session that has been auto-closed is a
historical record, not a workspace. Pinned stances for the four guards:

| Call site | Stance | Reason |
|---|---|---|
| `findLatestActiveSession` (`:~1416-1427`) | Stops matching abandoned rows | The conflict check must see the slot as free; this follows for free from `eq(status, 'active')` |
| `recordSet` (`:387-397`) | Reject | An abandoned session is not writable. Accepting sets would recreate a second live session behind the invariant |
| `completeSession` (`:453-480`) | Reject | Completing an auto-closed session would reintroduce the false-completion problem decision 1 exists to prevent |
| `deleteById` / `deleteAllByUser` (`:501-586`) | **Allow** | These guards exist to stop a user deleting a session that is currently in progress. An abandoned session is not in progress, so it must be deletable — otherwise the user accumulates undeletable rows and we have replaced one operational dead end with another |

Every direct SQL predicate in the repository uses exact-match `eq`, never inequality, so adding a third
enum value is additively safe for existing filters. The risk was never the SQL; it is exactly these four
semantic call sites.

**5. No backfill. Pre-existing rows keep `active` until touched.** There is no signal in the data that
distinguishes "abandoned five days ago" from "genuinely running" for historical rows beyond age, which is
the same inference we are removing. Same precedent as `muscleGroup` (`workout-session.ts:88-96`), which
shipped without a historical backfill. Consequence, stated plainly: an old `active` row is converted the
first time its owner starts a new session. Until then it stays `active`. Decision 6 makes the funnel query
tolerate that.

**6. The retention funnel must read `abandoned` OR (`active` AND older than the threshold).** This is the
highest-risk read in the change. Reading only the stored value would *undercount* every historical row
decision 5 leaves untouched. Reading only the inferred condition would *miss* rows already converted.
Reading both, as a union with the two conditions mutually exclusive by construction (an `abandoned` row is
no longer `active`), counts each session exactly once during the transition period and converges on the
stored value as the population turns over. The predicate must be written so that no row can satisfy both
arms. `sdd-design` owns the exact SQL; the counting contract is pinned here.

**7. Scope A now governs the under-24h case only, and its real defects are three.** With B auto-closing
anything past 24 hours, a conflict banner can only appear for a session started earlier the same day —
genuinely plausibly in progress. That reframes A from "escape hatch" to "deliberate choice", and the three
defects are:

   1. **No actions.** The banner is read-only text. It needs *Resume* (navigate to the blocking session's
      tracker) and *Discard* (abandon it and start the requested one).
   2. **Placement.** On `/plan` it renders inside `DayDetailPanel` (week-board section), not beside the Hero
      CTA that most likely triggered it, with no scroll-into-view and no focus management. This plausibly
      *is* the reported "every start button appeared dead" symptom — the banner existed elsewhere in the DOM
      and was never seen. The fix must move focus to the banner, not merely render it.
   3. **No date.** The banner names plan and day-of-week number only. The start date is the load-bearing
      fact when deciding whether to resume, and the issue asks for it explicitly.

   *Discard* reuses the same `abandoned` write path as B — one transition, two triggers (age, and explicit
   user choice) — rather than a second mechanism.

**8. Contracts is the single DTO source of truth.** `WorkoutSessionRecordStatus`
(`packages/contracts/src/index.ts:58`) is the one place the union is declared.

> **CORRECTED by `sdd-design`, 2026-08-07 — this decision's central claim was wrong.**
> Widening the union does **not** make TypeScript flag the two `isCompleted` derivations. Verified: both
> are plain `===` equality comparisons — `tracker-model.ts:116` (`session.status === "completed"`) and
> `tracker-logic.ts:248-249` (`session.status === "completed" || currentExercise === undefined`). No
> switch, no `never`, nothing exhaustive. They compile silently and treat `abandoned` as live.
>
> Mobile is actively wrong today: a fully-logged abandoned session has `currentExercise === undefined`, so
> it reports `isComplete: true` — a claimed completion that never happened, which is precisely the
> falsehood this change exists to prevent. **The forcing function must be built, not inherited**: a local
> exhaustive `sessionLifecycle` with a `never` default and a new `isTerminal`. See `design.md`.
>
> Also corrected: the contracts **export tests are unaffected**. `contracts.test.ts:61-72` asserts
> `Object.keys(contracts)` — runtime values — and every 17b addition is type-only.
> `contracts.test.ts:160-189` does need extending.

**9. Enum migration is additive `ALTER TYPE ... ADD VALUE`, with the repo's known Drizzle traps.**
`workoutSessionStatusEnum` is a real `pgEnum` (`schema.ts:669-672`), so `abandoned` is appended last to
preserve existing ordinals — the same additive shape `billingSourceEnum` used for `"stripe"`
(`schema.ts:123-131`). Two traps, both previously bitten in this repo: the Drizzle **journal `idx` entry
must be hand-checked**, because the SQL filename number is not authoritative and a missing journal entry
makes `migrate` silently skip the migration on deploy; and Postgres will not let a newly added enum value be
*used* in the same transaction that adds it, so the migration must not both add the value and write it.

**10. Verification gaps — CLOSED by `sdd-design`, 2026-08-07.** `getWeeklyOverview` and `getExerciseDetail`
were flagged by codegraph as `workoutSessions` consumers with unconfirmed status filtering. Both were
opened and both filter `completed`-only: `workout-session.ts:1271` and `:1346` respectively. **No change
required to either, and no unverified consumer remains.**

Confirmed unaffected for the same reason: `getDashboardSummary` (`:706-822`), `getClientDashboard`
(`:842-899`), `listCompletedSessions` (`:615-690`), muscle-group distribution and `getStatsRange` (`:~1091`).

One consumer that is **not** safe and was missed by the original inventory: `findById` (`:354-363`) has
**no status filter at all**, so a stale tracker URL would render live controls over a terminal session.
`sdd-design` moved the two tracker derivations into PR 1 for this reason.

### Changed-line forecast and PR boundary

Exploration's per-scope estimate, with D removed:

| Scope | Estimate |
|---|---|
| C — migration, contracts widen, funnel rewrite, call-site stances, cross-app consumers | ~200–400 |
| B — auto-close branch + tests | ~80–150 |
| A — resume/discard actions across 3 clients + placement/focus + i18n | ~150–300 |
| **Total** | **~430–850** |

**Honest budget signal (`delivery_strategy: ask-on-risk`): the upper half of that range exceeds the
800-line review budget.** I am not silently splitting to dodge it — I am recommending a split on its merits
and flagging the risk for the product owner.

**Recommended boundary: two PRs, C+B first, A second.**

| PR | Content | Why this boundary |
|---|---|---|
| 1 | C + B together | B's auto-close *requires* C's `abandoned` value; they cannot be separated without shipping a write to a status that does not exist. This PR alone removes the need for production database access — the actual incident. ~280–550 lines |
| 2 | A | Pure client work over an API that PR 1 already settled. Independently valuable, independently revertable. ~150–300 lines |

This inverts the exploration's suggested A-first order deliberately: A-first would ship a resume/discard
affordance for a 5-day-old session that PR 1 then makes unreachable, and would leave the production dead
end open for an extra PR cycle.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| #353 retention funnel double-counts or undercounts during the transition | **High** | Decision 6 pins a mutually-exclusive two-arm predicate; the existing integration test (`admin-stats.integration.test.ts:50, 461, 478`) must be extended with a mixed-population fixture (stored `abandoned` + untouched aged `active`) before the query changes |
| Migration silently skipped on deploy via a missing Drizzle journal entry | Med | Decision 9; hand-verify the journal `idx`. This has bitten this repo before |
| Enum value added and used in the same transaction fails on Postgres | Med | Decision 9; the migration adds the value only |
| Auto-close destroys data a user still wanted | Low | It cannot: the transition is a status update, never a delete. Every set and session-exercise row survives and stays readable |
| A user is surprised that their session vanished with no notice | **Med — open, see question round** | Not yet decided whether the start response signals "we closed a stale session for you" |
| `getWeeklyOverview` / `getExerciseDetail` turn out to include non-completed rows | Med | Decision 10 — explicit check in design/apply, not an assumption |
| Contracts export-order tests break the chain | Low | Decision 8 — known, mechanical |
| Concurrent double-tap on Start races the update-then-insert | Low | The existing user-row lock (`workout-session.ts:325-346`) already serializes it; add a test rather than new machinery |
| Coverage gate blocks the chain (apps/api functions threshold 85%, apps/web 90%) | Med | Tests ship in the same commit as each behaviour change; `pnpm -r --if-present test:coverage` is enforced on pre-push |

## Rollback Plan

- **PR 2 (A):** pure client change; revert in isolation. The read-only banner returns.
- **PR 1 (B):** revert the auto-close branch and `startSession` returns `conflict` for aged sessions again.
  Any rows already written `abandoned` remain valid and readable — they simply stop being produced.
- **PR 1 (C):** the enum value cannot be cleanly dropped once rows reference it, and it should not be. The
  additive widening is forward-only, exactly like `billingSourceEnum`'s `"stripe"`. If the funnel rewrite
  proves wrong, revert the *query* independently of the enum — decision 6's two-arm predicate is designed so
  that reverting to the pure inference arm still counts every session, only less precisely.

## Success Criteria

- [ ] A session older than 24 hours never blocks a new workout start; the new session starts and the old one
      is `abandoned`.
- [ ] The auto-closed session's `session_exercises` and set rows are all still present and readable
      afterwards.
- [ ] No auto-close ever writes `completed`; a test asserts this directly.
- [ ] `getRetentionFunnel` counts each session exactly once across a mixed population of stored-`abandoned`
      rows and untouched aged `active` rows.
- [ ] `recordSet` and `completeSession` reject an `abandoned` session; `deleteById` / `deleteAllByUser`
      accept it.
- [ ] Under 24 hours, the conflict banner names the blocking session's **start date**, offers Resume and
      Discard, and receives focus on `/plan` without the user scrolling to find it.
- [ ] Discard produces the same `abandoned` state as auto-close, behind one confirmation step.
- [ ] After an auto-close, the user is shown a non-blocking notice naming the closed session's date.
- [ ] An abandoned session appears in the user's session history with its logged sets, and offers no resume,
      no set logging and no completion from there.
- [ ] Unblocking a stuck user requires no production database access.
- [ ] `pnpm type-check`, `pnpm -r test` and `pnpm -r --if-present test:coverage` are green; the Drizzle
      journal entry for the new migration is present.

## Follow-up work

**Swallowed-error audit (scope D) — file as its own issue.** The exploration searched only
`apps/web/src/app/(app)/plan/**`, `apps/mobile/src/screens/**` and the create-plan proxy routes. **Billing,
memory, exercises, trainer and clients screens were never searched.** Folding an unbounded sweep into this
change's budget would either blow it or quietly truncate the audit. Two confirmed swallows for the new issue
to start from:

- `apps/web/src/app/(app)/plan/[id]/PlanStatusClient.tsx:138-144` — `handleRegenerate`'s catch block sets no
  error state and gives no UI feedback.
- `apps/web/src/app/(app)/plan/DayDetailPanel.tsx:85-90` — `navigateWeek` handles only `kind === "ok"` with
  no `else`; a failed week fetch silently keeps the stale week with no error and no retry.

Counter-example worth generalizing into the pattern that sweep should enforce:
`apps/mobile/src/api/plan-status-client.ts` + `PlanStatusScreen.tsx`, where every result is a discriminated
`{ kind: "error", ... }` rendered into a named `phase` and nothing is dropped.

## Proposal question round — RESOLVED (product owner, 2026-08-07)

The three forks from exploration were already closed. These four were surfaced while pinning the approach
above and are now decided. Three confirmed the proposal's working assumption; one did not.

1. **Should the user be told their stale session was auto-closed? → YES, non-blocking notice.** As assumed.
   The new session carries a notice naming the closed session's date ("we closed your unfinished session
   from 2 Aug"). Silent auto-close was rejected as reintroducing a smaller version of the original
   complaint — something happened to the user's data and nothing said so. This closes the risk table's one
   open Med item.

2. **Is an `abandoned` session visible to the user anywhere? → YES, as a read-only history record.**
   **This overrides the proposal's assumption of "not in this change".** An abandoned session appears in the
   user's session history with its logged sets, and is **terminal there**: no resume, no new sets, no
   completion. The "resumable" option was explicitly rejected, so **pinned decision 4 stands unchanged** —
   `recordSet` and `completeSession` still reject an abandoned session, and `abandoned` does not become a
   third live state. Resumability may be reconsidered as its own issue once the stored status has proven
   itself in production; it is not in this change.

   Scope consequence: this adds a read-only history surface and pushes the forecast past the 800-line
   review budget with certainty rather than probability. See the revised PR boundary below.

3. **Is 24 hours the right *behavioural* threshold? → REUSE 24h.** As assumed, per decision 3 and the
   issue's own request. One constant, one definition. Accepted consequence, recorded deliberately: a user
   who trains at 20:00, is interrupted, and returns at 21:00 the following evening has that session
   auto-closed. If that proves wrong in practice, the fix is to split the constant in two, not to stretch it.

4. **Under 24 hours, should Discard require a confirmation step? → YES, one confirm.** As assumed. The
   under-24h session is the one that plausibly holds real logged sets, and Discard sits beside Resume where
   a single mis-tap should not end it.

### Revised scope and PR boundary (supersedes the two-PR recommendation above)

Question 2 adds an in-scope item: **a read-only history surface listing abandoned sessions with their logged
sets**, terminal, on web and mobile. The forecast becomes roughly **530–1000 lines**, which exceeds the
800-line review budget in most of its range.

| PR | Content | Estimate |
|---|---|---|
| 1 | C + B — enum migration, contracts widen, funnel rewrite, call-site stances, auto-close branch, auto-close notice payload | ~280–550 |
| 2 | A — actionable under-24h banner: Resume, Discard (with confirm), start date, placement/focus; plus the auto-close notice UI | ~150–300 |
| 3 | History — read-only abandoned sessions in session history, web and mobile | ~100–200 |

PR 1 still stands alone as the fix for the actual incident: after it merges, unblocking a stuck user
requires no production database access.
