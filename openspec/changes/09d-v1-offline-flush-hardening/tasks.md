# Tasks: Harden Web Flush Pass Against IndexedDB Failures

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~157 (7 prod + 150 test) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | 4 store-boundary regression tests + production try/catch | PR 1 | `pnpm --filter web test -- --run -t "offline"` | N/A — pure Vitest unit test, no runtime to start | `git revert` on both changed files |

## Phase 1: RED — Regression Tests

- [x] 1.1 Write flaky-store factory: spread `createInMemoryOfflineStore()`, override target method to throw, plus `process.on("unhandledRejection")` listener helper registered/cleaned in try/finally
- [x] 1.2 Test: `entries()` throw (R1) → queue intact, zero unhandled rejections
- [x] 1.3 Test: `delete("mutations")` throw post-ack (R2) → not-removed mutations stay queued, zero unhandled rejections
- [x] 1.4 Test: `put("snapshots")` throw post-removal (R3) → queue empty, NOT retryable, snapshot stale, zero unhandled rejections
- [x] 1.5 Test: `delete("snapshots"/"meta")` cleanup throw (R4) → queue empty, pointer stale, NOT retryable, zero unhandled rejections

## Phase 2: GREEN — Production Fix

- [x] 2.1 Add inner try/catch around `await runFlushPass()` inside `flush()` do/while (lines 354-356), mirroring mobile flush pattern with invariant comment
- [x] 2.2 Run `pnpm --filter web test` — all 4 RED tests pass + no existing regressions

## Phase 3: REFACTOR — Edge Cases & Traceability

- [x] 3.1 Verify `finally` block correctly resets `isFlushingRef.current` when catch swallows a store throw
- [x] 3.2 Verify `flushAgainRef` loop re-triggers correctly when a re-trigger arrives during caught error
- [x] 3.3 Confirm delta-spec scenario coverage: R1→1.2, R2→1.3, R3→1.4, R4→1.5

## Phase 4: Review Remediation — Deterministic CRITICAL Blockers

- [x] 4.1 RED: regression tests for mounted account-switch rejection, collapsed raw-entry removal, and enqueue-success/snapshot-failure no-duplicate dispatch
- [x] 4.2 GREEN: revalidate the mounted identity before handler enqueue or direct mutation; surface `auth_required` on mismatch
- [x] 4.3 GREEN: remove every raw queued mutation represented by acknowledged or dropped collapsed mutations
- [x] 4.4 GREEN: stop after a successful enqueue when snapshot persistence fails; keep the mutation queued and surface `reload_required`
- [x] 4.5 TRIANGLE: cover record-set enqueue, complete enqueue, and direct start identity mismatch paths
- [x] 4.6 VERIFY: focused offline test, type-check, architecture, dependency guard, and build all pass

## Phase 5: Review Remediation — Mobile Offline Queue

- [x] 5.1 RED: mobile regression tests for raw collapsed-entry removal and record/complete enqueue-success snapshot-failure behavior
- [x] 5.2 GREEN: remove all raw mutations represented by acknowledged or dropped collapsed groups, while leaving unresolved entries queued
- [x] 5.3 GREEN: stop after durable enqueue when snapshot persistence fails and surface the existing localized reload-required notice
- [x] 5.4 TRIANGLE: cover both record-set and complete handlers; focused mobile offline suite passes 8/8

## Phase 6: Review Remediation — Identity Revalidation and Async Setup

- [x] 6.1 RED: mobile regressions for mounted account-switch flush rejection, unreachable identity preservation, and monitor cleanup after unmount
- [x] 6.2 GREEN: revalidate mobile identity immediately before flush dispatch and clean up a monitor created after unmount
- [x] 6.3 GREEN: allow web handler enqueue when identity revalidation is undefined or unreachable; resolved different identities still block
- [x] 6.4 TRIANGLE: mobile account-switch and unreachable-identity flush paths; web undefined and rejected identity handler paths
- [x] 6.5 VERIFY: focused mobile/web offline suites, PWA config tests, type-check, architecture, dependency guard, and build

## Phase 7: Review Remediation — Per-Session Completion Collapse and Handler Identity

- [x] 7.1 RED: add strict domain regressions for multiple session completions, same-session complete LWW, and deterministic post-set ordering; add mobile handler enqueue regressions for resolved identity switch and unavailable identity lookup
- [x] 7.2 GREEN: retain the latest `complete` per `sessionId`, sort surviving completes deterministically after set mutations, and revalidate mobile identity immediately before both enqueue handlers
- [x] 7.3 TRIANGLE: verify undefined/rejected mobile identity lookups preserve offline enqueue while resolved different identities are blocked; verify acknowledged raw-entry removal remains correct for all represented collapse groups
- [x] 7.4 VERIFY: domain/mobile focused suites, full web suite, E2E resource-safety tests, type-check, architecture, dependency guard, and build pass

## Phase 8: Review Remediation — Hydration Intent and Browser-Tab Identity

- [x] 8.1 RED: add web regressions for late offline hydration overwriting a newer start intent and for two tabs purging each other's queues; add same-tab account-switch coverage
- [x] 8.2 GREEN: guard hydration state writes with a start-intent version and scope the web identity marker to an opaque browser-tab session context
- [x] 8.3 RED/GREEN: add mobile complete-handler regressions for resolved identity switches and unavailable identity lookup; make resolved-different versus unreachable semantics explicit before enqueue
- [x] 8.4 TRIANGLE: verify web same-tab purge, cross-tab preservation, mobile set/complete enqueue behavior, and existing queue semantics
- [x] 8.5 VERIFY: focused web/mobile suites and mobile type-check pass; repository-wide safety gates remain to be run

### Phase 8 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 8.1 | `apps/web/src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts`, `apps/web/src/app/(app)/plan/offline/__tests__/identity.test.ts` | Integration/unit | 768/768 relevant web tests | Written and failed: hydration overwrite + cross-tab purge | Passed: 770/770 web tests | Same-tab switch remains purging; hydration preserves started session | Clean |
| 8.3 | `apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | Integration | 229/229 relevant mobile tests | New complete-handler cases added; existing behavior was already safe | Passed: 231/231 mobile tests | Set and complete cover different, undefined, and rejected identity resolution | Explicit status taxonomy |

### Phase 8 Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command and exact result | `pnpm --filter web test -- --run src/app/(app)/plan/offline/__tests__/identity.test.ts src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts` — 88 files, 770 tests passed; `pnpm --filter mobile test -- --run src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` — 35 files, 231 tests passed |
| Runtime harness command/scenario and exact result | N/A — Vitest hook/component and offline-store integration tests; no external runtime boundary is required |
| Rollback boundary | Revert the six changed web/mobile implementation and regression-test files from Phase 8 together |

## Phase 9: Review Remediation — Mobile Hydration, Flush, Identity Cleanup, and Connectivity

- [x] 9.1 RED: add mobile regressions for identity switching during snapshot hydration, multi-session acknowledged snapshot persistence, concurrent identity cleanup, and NetInfo teardown
- [x] 9.2 GREEN: revalidate identity immediately before applying hydrated state; retain/update acknowledged snapshots for every session; drain identity-scoped stores until stable; retain and invoke NetInfo unsubscribe
- [x] 9.3 TRIANGLE: cover same-session acknowledgement updates, active multi-session snapshots, interleaved mutation insertion during cleanup, and last-listener monitor teardown
- [x] 9.4 VERIFY: focused mobile/domain/web/script tests, type-check, architecture, dependency guard, and build pass

### Phase 9 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 9.1–9.2 hydration race | `apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | Integration | ✅ 15/15 pre-change | ✅ stale snapshot applied before fix | ✅ 17/17 passed | ✅ account switch falls through to current network session | ✅ monitor cleanup shared with existing setup guard |
| 9.1–9.2 multi-session flush | `apps/mobile/src/offline/__tests__/flush.test.ts`, `apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | Unit/integration | ✅ 38/38 pre-change | ✅ only last session snapshot was retained | ✅ 43/43 focused mobile tests passed | ✅ latest same-session ack plus distinct active sessions | ✅ deterministic first-ack order with latest per session |
| 9.1–9.2 identity cleanup | `apps/mobile/src/offline/__tests__/identity.test.ts` | Unit | ✅ 10/10 pre-change | ✅ interleaved mutation survived one enumeration | ✅ 11/11 passed | ✅ mutation inserted during delete is removed on next drain | ✅ stable drain loop |
| 9.1–9.2 connectivity cleanup | `apps/mobile/src/offline/__tests__/connectivity.test.ts` | Unit | ✅ 4/4 pre-change | ✅ NetInfo unsubscribe was never called | ✅ 5/5 passed | ✅ last external listener releases subscription | ✅ retained existing listener unsubscribe semantics |

### Phase 9 Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused tests | `pnpm --filter mobile exec vitest run "src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx" "src/offline/__tests__/identity.test.ts" "src/offline/__tests__/connectivity.test.ts" "src/offline/__tests__/flush.test.ts"` → 4 files / 43 tests passed; domain collapse 1 file / 8 passed; web offline 1 file / 24 passed; script resource safety 1 file / 78 passed |
| Runtime harness | N/A — Vitest unit/integration coverage exercises the real mobile screen and injected store/connectivity ports; no external runtime boundary is required |
| Rollback boundary | Revert only the Phase 9 mobile implementation/tests and this appended evidence section; no canonical spec, contract, dependency, or API changes |

### Phase 9 Verification Evidence

| Command | Exact result |
|---|---|
| `pnpm --filter mobile test -- --run src/offline/__tests__/identity.test.ts src/offline/__tests__/connectivity.test.ts src/offline/__tests__/flush.test.ts src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | PASS: 35 files / 236 tests; includes 43 targeted tests |
| `pnpm --filter domain exec vitest run src/offline/__tests__/collapse-queue.test.ts` | PASS: 1 file / 8 tests |
| `pnpm --filter web exec vitest run "src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts"` | PASS: 1 file / 24 tests |
| `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` | PASS: 1 file / 78 tests; expected simulated cleanup/spawn stderr only |
| `pnpm type-check` | PASS: all 6 workspace projects |
| `pnpm architecture` | PASS: no dependency violations; negative guard passed |
| `pnpm deps-guard` | PASS: no prohibited packages |
| `pnpm build` | PASS: dependency/UI/API/architecture guards and workspace builds completed |
