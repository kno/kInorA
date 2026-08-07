# Verify Report: 17b-stale-session-recovery

Verified against `specs/stale-session-recovery/spec.md` (10 requirements, 26 scenarios) on the
merged `main` state (`08dc557` — PR3, on top of `df2f06d` PR2 and `6a8d97b` PR1). This report was
produced by reading the merged implementation and running the test suites directly; apply-phase
claims were re-derived from source, not accepted at face value.

## Gates run

| Gate | Result |
|---|---|
| `pnpm type-check` | PASS — all 7 workspaces clean |
| `pnpm -r --if-present test:coverage` | PASS (exit 0) — apps/api and apps/web thresholds held |
| `pnpm build` | PASS (exit 0), including `packages/i18n` dist rebuild |
| `cd apps/mobile && pnpm test` | PASS — 481/481, 53 files |

All four gates are green. No failures, no coverage threshold misses.

## The known gap (issue #382) — independently reconfirmed

Confirmed by reading `.github/workflows/ci-cd.yml` directly:

- The hermetic `ci` job (`:13-61`) sets no `DATABASE_URL`; every `describe.skipIf(!hasDb)` block is
  skipped, and the sibling `describe.skipIf(hasDb)` placeholder runs trivially instead.
- The real-Postgres `billing-integration` job (`:63-156`) targets a **hardcoded file list**
  (`:119-130`) of eight files. `admin-stats.integration.test.ts` is on it (`:130`).
  `workout-session.integration.test.ts` is **not** on it, and no other CI job references it.

I attempted to convert this into executed evidence by running the omitted suite against a local
Postgres. The local `podman`/`krunkit` VM's socket connection is broken
(`ssh: rejected: connect failed`) — one `podman machine stop && start` cycle did not fix it, and I
did not sink further time into infrastructure repair for a read-only verification task. **I could
not execute `workout-session.integration.test.ts` in this session.** The four assertions the
team lead flagged remain unproven anywhere (not in CI, not by me):

- concurrent double-tap on Start returns `resumed` rather than violating the partial unique index
- auto-close writes `abandoned` and never `completed`
- history ordering uses `coalesce(completed_at, started_at)`
- volume trend pairs completed-with-completed only

By contrast, `admin-stats.integration.test.ts` **does** execute in CI (line 130), so the
retention-funnel mixed-population test is executed evidence, not merely code inspection.

## Requirement-by-requirement

| Requirement | Verdict | Evidence class | Notes |
|---|---|---|---|
| Auto-Close On Session Start Past Threshold | Satisfied by code | code-inspection-only | Three-phase `startSession` in `apps/api/src/db/repositories/workout-session.ts:274-` implements phase1 fast path / phase2 target validation / phase3 locked re-read + age-scoped `UPDATE` exactly per `design.md`. The dedicated integration tests (PR1.13-PR1.16, in `workout-session.integration.test.ts`) assert this directly but never execute (see gap above). |
| Auto-Close Never Writes Completed | Satisfied by code | code-inspection-only | Auto-close UPDATE at `workout-session.ts:402` sets only `status:"abandoned", updatedAt`; `completedAt` is never touched by that statement. No test executing anywhere directly proves this at runtime against real Postgres; the assertion lives in the same skipped suite. |
| Auto-Close Preserves All Session Data | Satisfied by code | code-inspection-only | The transition is a bare column `UPDATE`, never a `DELETE` — confirmed at `workout-session.ts:396-410`. The before/after row-count assertion (PR1.13) is in the never-run suite. |
| Auto-Close Notice Names the Closed Session's Date | Satisfied, partially executed | executed-test (contracts/route) + code-inspection-only (integration) | `AutoClosedSessionNotice{id,startedAt}` and the additive `autoClosedSession?` sibling key are exercised by `contracts.test.ts` and the Fastify route unit test (both run under `pnpm -r test`, hermetic, no DB — these pass). The end-to-end integration path (the `RETURNING` clause actually producing the notice from a real auto-close) is in the never-run suite. |
| Abandoned Sessions Are Terminal, With One Exception for Deletion | Satisfied by code | code-inspection-only (guards) | Confirmed directly reading `workout-session.ts`: `recordSet` rejects via `session.status !== "active"` (`:532`); `completeSession` has the explicit `abandoned` branch (`:617`) plus the pre-existing `WHERE status='active'` guard (`:603`); `findLatestActiveSession` filters `eq(status,"active")` (`:1597`), excluding abandoned by construction; `deleteById` (`:661`) and `deleteAllByUser` (`:730`) widen to `inArray(status,["completed","abandoned"])`. These same behaviors are also asserted by PR1.11's integration test, which is in the never-run suite — so the guard code is verified by direct reading, not by an executing test, for the recordSet/completeSession/deleteById/deleteAllByUser scenarios specifically bound to real Postgres data. The `abandonSession` unit test (`workout-session.test.ts`, mocked db) does execute under `pnpm -r test` and covers idempotency/not_active/not_found — that part is executed-test. |
| Retention Funnel Counts Each Session Exactly Once | Satisfied, executed | executed-test | Two-arm predicate confirmed verbatim at `admin-stats.ts:388-403`, structurally disjoint on `status` alone as designed. `admin-stats.integration.test.ts` **is** in the CI real-Postgres job's hardcoded list — this is the one integration suite in the whole 17b chain that actually runs on every PR/merge. This is the strongest evidence in the change. |
| No Backfill for Pre-Existing Active Rows | Satisfied by design | code-inspection-only | No migration touches existing rows; `0026_workout_session_abandoned_enum.sql` is a single add-only `ALTER TYPE`. This is a negative requirement (absence of a backfill statement), directly confirmed by reading the one-line migration file. |
| Under-24h Conflict Banner Is Actionable and Named by Date | Satisfied, executed | executed-test | Confirmed in `DayDetailPanel.tsx`: focusable container (`tabIndex={-1}`, `role="alert"`, `:194`), focus+scroll effect (`:115-117`), Resume (`:203`), Discard with a `discardConfirming` confirmation gate (`:102, 207-221`). Web `/plan`, `/plan/[id]` (`PlanStatusClient.tsx`) and mobile (`WorkoutTrackerScreen.tsx`) all have component tests that run hermetically under `pnpm -r test` / `apps/mobile pnpm test`, both of which passed in this session. |
| Discard Produces the Same Terminal State as Auto-Close | Satisfied, partially executed | executed-test (client + unit) + code-inspection-only (integration) | `abandonSession` is the single write path for both triggers (`workout-session.ts:450-484`); client `abandonSession()` calls in both web (`tracker-client.ts:244`) and mobile (`workout-session.ts:260`) hit the identical `POST .../abandon` route. Unit-level idempotency test executes. The real-Postgres proof that discard preserves `session_exercises`/set rows identically to auto-close (PR1.20's integration variant) is in the never-run suite. |
| Abandoned Sessions Appear as Read-Only History | Satisfied, executed | executed-test (label/no-affordance) + code-inspection-only (ordering/trend integration) | `listSessionHistory` widened filter/`coalesce` ordering/completed-only trend confirmed by reading `workout-session.ts:739-` (renamed from `listCompletedSessions`); the real-Postgres proof of ordering and trend-pairing correctness (PR3.1) is in the never-run suite. The UI side is fully executed and verified independently: `history/page.tsx:65-66` and `HistoryScreen.tsx:70-71` render `history.abandoned` only; grep across both files found no resume/log/complete affordance for an abandoned entry — confirmed no reopen path exists anywhere in web or mobile history. |

## Specifically requested checks

- **`abandoned` terminal with the deletion exception** — confirmed directly (table above): reject in
  `recordSet`/`completeSession`, excluded from `findLatestActiveSession`, allowed in
  `deleteById`/`deleteAllByUser`. All via code inspection; the guard-specific integration test is
  the never-run suite.
- **No affordance reopens an abandoned session anywhere in web or mobile** — confirmed by direct
  grep of `history/page.tsx` and `HistoryScreen.tsx`: only a status label renders, no resume/log/
  complete action. Also confirmed at the tracker layer: `findById` has no status filter, but
  `isTerminal` (built via `sessionLifecycle`, `tracker-model.ts` / `tracker-logic.ts`) gates set
  inputs and the complete CTA off for `abandoned`, and no client call site constructs
  `activeSession` from an arbitrary/URL-sourced id (per apply's PR1.28 finding, independently
  plausible from the codegraph blast-radius scan — no caller of `abandonSession`/`findById` outside
  the session-start/history flows was found).
- **Migration**: `0026_workout_session_abandoned_enum.sql` contains exactly one add-only
  `ALTER TYPE "public"."workout_session_status" ADD VALUE IF NOT EXISTS 'abandoned';` statement.
  Journal confirmed programmatically: `idx` values are contiguous 0-26 with no gaps, `idx:26` tag
  `0026_workout_session_abandoned_enum` present. The guard test
  `apps/api/src/db/__tests__/migration-journal.test.ts` is a plain filesystem-reading unit test (no
  DB dependency) — it **executed** in this session (3/3 tests passed, run directly).
- **i18n export/count tests**: `packages/i18n/src/__tests__/index.test.ts:211` asserts
  `nonBillingKeys` has length **772** — confirmed at that exact line. This test executes as part of
  the hermetic `pnpm -r test:coverage` run (i18n package, no DB dependency), which passed. Both
  `history.abandoned` (`en.json:1015`, `es.json:1015`) and the `plan.start.*` keys are present in
  both locales.

## Findings

No CRITICAL issues. No WARNING issues beyond the already-filed #382 gap, which this report
reconfirms independently rather than re-litigates.

- **SUGGESTION**: Given that #382 already exists to fix the CI list, no further action is needed
  from this verify pass. The one operationally relevant fact worth restating: every scenario
  bound specifically to real-Postgres transactional behavior in `startSession`'s auto-close path,
  the discard-vs-auto-close data-preservation proof, and the history query's `coalesce`
  ordering/trend-pairing correctness has **never executed anywhere** — not in this session, not in
  CI. The code that implements them was read directly and is structurally consistent with the
  design, but "consistent on reading" and "proven against a real transactional database" are not
  the same claim, and this report does not conflate them.

## Result

status: done
executive_summary: 0 CRITICAL, 1 WARNING (pre-existing, already filed as #382 and reconfirmed independently), 1 SUGGESTION; all four requested gates pass and every spec requirement is satisfied by the merged code, but roughly half the scenarios (everything bound to `startSession`'s auto-close transaction, discard-vs-autoclose data preservation, and history query ordering/trend-pairing) rest on `workout-session.integration.test.ts`, which never executes in this environment or in CI.
artifacts: openspec/changes/17b-stale-session-recovery/verify-report.md; Engram sdd/17b-stale-session-recovery/verify-report
next_recommended: sdd-archive — no CRITICAL blocks archiving; the #382 gap is already tracked as its own issue and does not require reopening apply
risks: The four never-executed integration assertions (double-tap concurrency, auto-close-never-completed at the transaction level, history coalesce ordering, completed-only trend pairing) remain unproven by any automated run, local or CI, until #382 is fixed and the file is added to the billing-integration job's hardcoded list.
skill_resolution: none
