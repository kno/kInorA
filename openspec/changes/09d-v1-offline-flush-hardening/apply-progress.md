# Apply Progress: Harden Web Flush Pass Against IndexedDB Failures

**Change**: 09d-v1-offline-flush-hardening
**Mode**: Strict TDD (openspec `strict_tdd: true`, runner `pnpm --filter web test` = `vitest run`)
**Artifact store**: openspec (file-based)
**Delivery**: single PR (review budget 400 lines, forecast ~157; no size exception required)
**PR boundary**: one reviewable work unit — four store-boundary regression tests + inner try/catch around `runFlushPass` in web `flush()`

## Tasks Completed

| Phase | Task | Status |
|-------|------|--------|
| 1 (RED) | 1.1 flaky-store factory + `unhandledRejection` helper | ✅ |
| 1 (RED) | 1.2 R1 — `entries()` throw | ✅ |
| 1 (RED) | 1.3 R2 — `delete("mutations")` throw post-ack | ✅ |
| 1 (RED) | 1.4 R3 — `put("snapshots")` throw post-removal | ✅ |
| 1 (RED) | 1.5 R4 — cleanup `delete("snapshots")` throw | ✅ |
| 2 (GREEN) | 2.1 inner try/catch around `await runFlushPass()` | ✅ |
| 2 (GREEN) | 2.2 `pnpm --filter web test` — all pass | ✅ |
| 3 (REFACTOR) | 3.1 `finally` resets `isFlushingRef.current` on caught throw | ✅ |
| 3 (REFACTOR) | 3.2 `flushAgainRef` re-trigger preserved | ✅ |
| 3 (REFACTOR) | 3.3 scenario coverage traceability | ✅ |

`tasks.md` checkboxes flipped to `[x]`.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `apps/web/src/app/(app)/plan/use-workout-session.ts` | Modified | Added inner `try { await runFlushPass(); } catch { /* invariant comment */ }` inside the `flush()` do/while loop (mirrors mobile `WorkoutTrackerScreen.tsx` lines 342–352). `finally` block and `flushAgainRef` re-trigger loop unchanged. |
| `apps/web/src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts` | Modified | Added `OfflineStore`/`OfflineStoreName` + `readActiveSessionPointer` imports; added `trackUnhandledRejections()` shared helper (registers/cleans `process.on("unhandledRejection")` in `try/finally`); added a new `describe` block with four boundary regression tests (R1–R4), each injecting a flaky store via `{ ...store, <method> }` spread+override. |

No mobile, API, schema, dependency, or canonical-spec edits were made by the web remediation above.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1–1.5 (R1) | `__tests__/use-workout-session.offline.test.ts` | Integration (real hook + in-memory store + jsdom) | ✅ 757/757 pre-existing | ✅ Written — `expected [Error: simulated storage failure] to deeply equal []` | ✅ Passed after fix | ✅ 4 distinct boundaries (entries/delete/put/cleanup) | ✅ Clean (shared helpers, no duplication) |
| 2.1 (GREEN fix) | n/a — production code | n/a | n/a (test-first) | n/a | ✅ All 4 RED tests → green | n/a | ✅ Mirrors mobile pattern; invariant comment inline |

Safety-net baseline (before edit): `pnpm --filter web test` → 88 files, 757 tests, all pass.
After fix: `pnpm --filter web test` → 88 files, 761 tests, all pass (757 + 4 new).

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `pnpm --filter web test -- --run "src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts"` → 88 files / 761 tests passing (RED run before fix: 4 failed \| 757 passed). |
| Runtime harness command/scenario and exact result | N/A — pure Vitest unit/integration in jsdom; no app runtime to start (web hook exercised via `renderHook` + injected in-memory store + fake connectivity monitor). |
| Rollback boundary | `git checkout HEAD~1 -- apps/web/src/app/(app)/plan/use-workout-session.ts apps/web/src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts` reverts both files; no schema/dependency/contract side-effects. |

## Commands Run (with exact results)

| Command | Result |
|---------|--------|
| `pnpm --filter web test -- --run "…/use-workout-session.offline.test.ts"` (RED, before fix) | 4 failed \| 757 passed (761 total) — all 4 new tests fail with `expected [Error: simulated storage failure] to deeply equal []` |
| `pnpm --filter web test -- --run "…/use-workout-session.offline.test.ts"` (GREEN, after fix) | 88 files / 761 tests passed |
| `pnpm type-check` | Done across all 6 workspace projects (contracts, i18n, domain, api, mobile, web) |
| `pnpm architecture` | ✔ no dependency violations (1562 modules, 4451 deps); negative guard passed |

## Deviations from Design

None. The inner try/catch matches the design's "Exact Code Change" block verbatim (comment expanded to capture the precise partial-delete + post-removal semantics from the delta spec). The flaky-store helper is a per-test spread+override rather than a single shared factory returning all four variants — simpler, each test names exactly the boundary it overrides, and the `trackUnhandledRejections` helper covers the shared listener lifecycle.

## Issues Found

- Transient: during the first RED run, three unrelated tests in `apps/web/src/app/(auth)/callback/social/__tests__/route.test.ts` timed out (5s) under system load (transform phase took ~140s). A subsequent run of the same suite passed cleanly (10 tests). Not a pre-existing failure, not caused by this change, and outside the files modified.

## Remaining Tasks

None from this work unit. Ready for `sdd-verify`.

## Scenario Coverage Traceability

| Delta-spec scenario | Test |
|---|---|
| `Entries() read throws` | R1 (1.2) |
| `RemoveMutation delete throws` | R2 (1.3) |
| `WriteSnapshot throws after removal completes` | R3 (1.4) |
| `Cleanup throws after removal and snapshot write` | R4 (1.5) |
| `Retry on next valid trigger` | Covered by R1/R2 assertions — mutation stays queued and MAY retry (matching existing sequential-flush reconnect tests) |
| `Throwing-store regression test` | R1 mirrors the mobile pattern at `WorkoutTrackerScreen.offline.test.tsx:301` |

## Review Remediation Progress — 2026-07-20

The successor review reported three deterministic CRITICAL blockers in the web hook. The remediation was applied after writing the focused regression tests; no chronology is inferred for the earlier 09d phases above.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1 mounted identity guard | `apps/web/src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts` | Integration (real hook + in-memory store + jsdom) | ✅ 20 pre-change tests | ✅ 1 failed before fix | ✅ passed | ✅ record, complete, direct start | ✅ shared validation helper |
| 4.2 collapsed raw removal | `apps/web/src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts` | Integration | ✅ 20 pre-change tests | ✅ 1 failed before fix | ✅ passed | ✅ duplicate raw `setId` entries | ✅ pure group-matching helper |
| 4.3 enqueue persistence failure | `apps/web/src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts` | Integration | ✅ 20 pre-change tests | ✅ 1 failed before fix | ✅ passed | ✅ queued record-set mutation remains durable | ✅ enqueue-success flag |

### Files Changed for Remediation

| File | Action | Evidence |
|------|--------|----------|
| `apps/web/src/app/(app)/plan/use-workout-session.ts` | Modified | Added handler identity revalidation, raw collapse-group acknowledgement removal, and no-fallback behavior after successful enqueue |
| `apps/web/src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts` | Modified | Added 3 blocker regressions plus 2 identity triangle cases; existing offline assertions updated for the required handler revalidation call |

### Work Unit Evidence

| Evidence | Required value |
|----------|---------------|
| Focused test command and exact result | `pnpm --filter web exec vitest run "src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts"` → 1 file / 22 tests passed |
| Runtime harness command/scenario and exact result | N/A — jsdom integration test exercises the hook with injected in-memory store and fake connectivity; no app runtime boundary is required |
| Rollback boundary | Revert only `apps/web/src/app/(app)/plan/use-workout-session.ts`, `apps/web/src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts`, and the appended 09d remediation sections |

### Verification Evidence

| Command | Exact result |
|---------|--------------|
| `pnpm --filter web exec vitest run "src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts"` | 1 file / 22 tests passed |
| `pnpm --filter web test` | 88 files / 766 tests passed |
| `pnpm type-check` | All 6 workspace projects passed |
| `pnpm architecture` | No dependency violations; negative guard passed |
| `pnpm deps-guard` | Dependency guard passed; no prohibited packages |
| `pnpm build` | Dependency/UI/API/architecture guards passed; contracts, i18n, domain, API, and web builds passed |

### Remediation Status

All three deterministic CRITICAL web blockers are covered by regression tests and fixed. Mobile remediation is recorded separately below; no API, schema, dependency, or canonical-spec files were changed.

## Mobile Review Remediation Progress — 2026-07-20

The successor review identified the mobile equivalents of the collapsed raw-entry and enqueue-success/snapshot-failure blockers. This section records only the new mobile chronology; earlier web remediation chronology remains unchanged.

### Tasks Completed

| Task | Status | Evidence |
|------|--------|----------|
| 5.1 mobile RED regressions | ✅ | Added raw collapse cleanup plus record/complete snapshot-failure tests before production changes |
| 5.2 raw collapsed-entry removal | ✅ | Mobile flush removes every raw entry represented by acknowledged/dropped collapsed groups; unresolved groups remain queued |
| 5.3 enqueue-success snapshot failure | ✅ | Record and complete handlers return after durable enqueue, retain the queue entry, and surface `reload_required`; no direct API replay |
| 5.4 triangle coverage | ✅ | Both mutation handlers covered; `WorkoutTrackerScreen.offline.test.tsx` passes 8/8 |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.1–5.2 | `apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | Integration | ✅ 5/5 | ✅ 1 raw-entry failure before fix | ✅ 8/8 | ✅ duplicate set entries plus existing retry path | ✅ local pure matcher |
| 5.3–5.4 | `apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | Integration | ✅ 5/5 | ✅ 2 direct-dispatch failures before fix | ✅ 8/8 | ✅ record-set and complete handlers | ✅ shared enqueue-success guard pattern |

### Verification Evidence

| Command | Exact result |
|---------|--------------|
| `pnpm --filter mobile exec vitest run "src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx"` | 1 file / 8 tests passed |
| `pnpm type-check` | All 6 workspace projects passed |

### Files Changed

| File | Action | Evidence |
|------|--------|----------|
| `apps/mobile/src/screens/WorkoutTrackerScreen.tsx` | Modified | Removed represented raw entries and prevented direct replay after successful enqueue; added reload-required notice |
| `apps/mobile/src/screens/tracker/messages.ts` | Modified | Reused existing shared `tracker.sync.reload_required` catalog key |

## Review Remediation Progress — 2026-07-20 (Current Findings)

The latest review identified two remaining findings: completion collapse was global instead of session-scoped, and mobile enqueue handlers could write using a stale mounted identity. The fixes preserve tenant/account isolation and do not modify canonical specs.

### Tasks Completed

| Task | Status | Evidence |
|---|---|---|
| 7.1 RED regressions | ✅ | Domain multiple-session/same-session completion tests and mobile handler identity tests were written before production changes |
| 7.2 per-session collapse + handler gate | ✅ | `collapseQueue` keeps one latest completion per `sessionId`; both mobile enqueue handlers revalidate immediately before enqueue |
| 7.3 triangle coverage | ✅ | Resolved different identity blocks; undefined identity preserves enqueue; rejected identity remains allowed; existing raw represented-entry removal path audited and retained |
| 7.4 verification | ✅ | All requested focused/full suites and repository gates passed |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 7.1–7.2 collapse semantics | `packages/domain/src/offline/__tests__/collapse-queue.test.ts` | Unit | ✅ 6/6 | ✅ 1 failed / 7 passed before fix | ✅ 8/8 | ✅ distinct sessions + same-session LWW + deterministic ordering | ✅ explicit deterministic tie-breakers |
| 7.1–7.2 mobile enqueue identity | `apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | Integration | ✅ 11/11 | ✅ 1 failed / 12 passed before fix | ✅ 13/13 | ✅ resolved switch blocked + undefined lookup allowed; existing rejected lookup flush path retained | ✅ shared `revalidateOfflineIdentity` helper |

### Files Changed for Current Findings

| File | Action | Evidence |
|---|---|---|
| `packages/domain/src/offline/collapse-queue.ts` | Modified | Replaced the global completion representative with a `sessionId` map and deterministic ordering after sets |
| `packages/domain/src/offline/__tests__/collapse-queue.test.ts` | Modified | Added multiple-session completion retention/order and same-session client-sequence LWW regressions |
| `apps/mobile/src/screens/WorkoutTrackerScreen.tsx` | Modified | Added lightweight identity revalidation immediately before record-set and complete enqueue; only resolved different identities block, while undefined/rejected lookup preserves offline writes |
| `apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | Modified | Added focused handler identity-switch and unavailable-identity regressions |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused tests | `pnpm --filter domain exec vitest run src/offline/__tests__/collapse-queue.test.ts` → 1 file / 8 tests passed; `pnpm --filter mobile exec vitest run "src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx"` → 1 file / 13 tests passed |
| Runtime harness | N/A — unit/integration Vitest tests exercise the pure collapse function and real mobile screen with injected in-memory store/connectivity; no app runtime boundary is required |
| Rollback boundary | Revert only the four implementation/test files listed above plus this appended 09d evidence; no contract, schema, dependency, or canonical-spec side effects |

### Verification Evidence

| Command | Exact result |
|---|---|
| `pnpm --filter domain exec vitest run src/offline/__tests__/collapse-queue.test.ts` | PASS: 1 file / 8 tests |
| `pnpm --filter mobile exec vitest run "src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx"` | PASS: 1 file / 13 tests; existing `react-test-renderer` deprecation warnings only |
| `pnpm --filter web test` | PASS: 88 files / 767 tests |
| `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` | PASS: 1 file / 78 tests; expected simulated cleanup/spawn stderr only |
| `pnpm type-check` | PASS: all 6 workspace projects |
| `pnpm architecture` | PASS: no dependency violations; negative guard passed |
| `pnpm deps-guard` | PASS: no prohibited packages |
| `pnpm build` | PASS: dependency/UI/API/architecture guards and workspace builds completed |

### TDD Execution Chronology

| Cycle | Exact evidence |
|---|---|
| RED | Domain: 1 failed / 7 passed because the global completion was retained; mobile: 1 failed / 12 passed because the switched identity still enqueued |
| GREEN | Domain: 8/8 passed after per-session completion map; mobile: 13/13 passed after handler revalidation gate |
| TRIANGLE | Domain covered distinct sessions, same-session LWW, and deterministic ordering; mobile covered resolved switch blocking and undefined lookup preservation, with prior rejected lookup coverage retained |
| REFACTOR | Deterministic `setId`/`sessionId` tie-breakers and one shared mobile revalidation helper; focused suites remained green |

## Review Remediation Progress — 2026-07-20 (Current Blockers)

The latest native review identified a mobile mounted-identity flush race, a web
offline enqueue loss when identity revalidation was unavailable, and an async
mobile connectivity-monitor setup race. These fixes were implemented with
focused RED/GREEN/Triangle coverage; no canonical specs were changed.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 6.1–6.2 mobile identity guard | `apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | Integration | ✅ 10/10 pre-change | ✅ account-switch test failed because API dispatched | ✅ 11/11 passed | ✅ switched identity + unreachable identity | ✅ shared monitor counters and guarded setup |
| 6.1 mobile async setup | `apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | Integration | ✅ 10/10 pre-change | ✅ cleanup assertion failed (`unsubscribeCalls` 0) | ✅ 11/11 passed | ✅ monitor resolves after unmount | ✅ local unsubscribe after post-await mount check |
| 6.3 web identity availability | `apps/web/src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts` | Integration | ✅ 22/22 pre-change | ✅ undefined identity test failed with empty queue | ✅ 23/23 passed | ✅ undefined + rejected lookup paths | ✅ single validation helper |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused tests | `pnpm --filter mobile exec vitest run "src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx"` → 1 file / 11 tests passed; `pnpm --filter web exec vitest run "src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts"` → 1 file / 23 tests passed |
| Runtime harness | N/A — integration tests exercise the real hooks/screen with injected in-memory stores and connectivity monitors; no app runtime boundary is required |
| Rollback boundary | Revert `apps/mobile/src/screens/WorkoutTrackerScreen.tsx`, its focused offline test, `apps/web/src/app/(app)/plan/use-workout-session.ts`, its focused offline test, and this appended 09d evidence |

### Verification Evidence

| Command | Exact result |
|---|---|
| `pnpm --filter mobile exec vitest run "src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx"` | PASS: 1 file / 11 tests |
| `pnpm --filter web exec vitest run "src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts"` | PASS: 1 file / 23 tests |
| `pnpm type-check` | PASS: all 6 workspace projects; one initial test-helper implicit-`any` failure was fixed before the passing run |
| `pnpm architecture` | PASS: no dependency violations; negative guard passed |
| `pnpm deps-guard` | PASS: no prohibited packages |
| `pnpm build` | PASS: dependency/UI/API/architecture guards and workspace builds completed |
| `apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | Modified | Added deterministic mobile regressions and triangle coverage |

## Mobile Review Remediation Progress — 2026-07-20 (Phase 9 Current Findings)

The latest native review identified four mobile findings: cached hydration could apply after an account switch, flush persisted only the last acknowledged session, identity cleanup could miss an interleaved mutation, and the NetInfo subscription teardown was discarded. These fixes preserve account isolation and offline queue semantics; canonical specs were not changed.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Hydration identity race | `apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | Integration | ✅ 15/15 | ✅ failed before post-read identity check | ✅ passed | ✅ stale cache refused and current network state used | ✅ safe context/monitor detachment |
| Multi-session acknowledged snapshots | `apps/mobile/src/offline/__tests__/flush.test.ts`, `apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | Unit/integration | ✅ 38/38 | ✅ only `lastAckedSession` available | ✅ passed | ✅ same-session latest ack and distinct session persistence | ✅ `ackedSessions` map preserves deterministic first-ack order |
| Concurrent identity cleanup | `apps/mobile/src/offline/__tests__/identity.test.ts` | Unit | ✅ 10/10 | ✅ injected mutation survived | ✅ passed | ✅ re-enumeration removes injected entry | ✅ bounded per-pass matching loop |
| Connectivity teardown | `apps/mobile/src/offline/__tests__/connectivity.test.ts` | Unit | ✅ 4/4 | ✅ NetInfo unsubscribe count was 0 | ✅ passed | ✅ last listener releases native subscription | ✅ existing callback unsubscribe retained |

### Files Changed for Phase 9

| File | Action | Evidence |
|---|---|---|
| `apps/mobile/src/screens/WorkoutTrackerScreen.tsx` | Modified | Revalidates identity immediately before cached hydration state writes and persists every acknowledged session snapshot |
| `apps/mobile/src/offline/flush.ts` | Modified | Returns latest acknowledged session per session in deterministic acknowledgement order |
| `apps/mobile/src/offline/identity.ts` | Modified | Re-enumerates each scoped store until no matching entries remain |
| `apps/mobile/src/offline/connectivity.ts` | Modified | Retains and invokes NetInfo unsubscribe when the last monitor listener leaves |
| `apps/mobile/src/screens/__tests__/WorkoutTrackerScreen.offline.test.tsx` | Modified | Added hydration-race and multi-session snapshot regressions; adjusted identity-call fixtures for the new validation step |
| `apps/mobile/src/offline/__tests__/flush.test.ts` | Modified | Added per-session acknowledgement regression |
| `apps/mobile/src/offline/__tests__/identity.test.ts` | Modified | Added deterministic interleaved-enqueue cleanup regression |
| `apps/mobile/src/offline/__tests__/connectivity.test.ts` | Modified | Added native subscription teardown regression |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused tests | Mobile 4 files / 43 tests; domain 1 file / 8 tests; web offline 1 file / 24 tests; script resource safety 1 file / 78 tests — all passed |
| Runtime harness | N/A — injected mobile store/connectivity integration and pure offline unit tests; no external runtime boundary |
| Rollback boundary | Revert the eight Phase 9 implementation/test files and this evidence section together; no canonical spec or dependency changes |

### Verification Evidence

| Command | Exact result |
|---|---|
| `pnpm type-check` | PASS: all 6 workspace projects |
| `pnpm architecture` | PASS: no dependency violations; negative guard passed |
| `pnpm deps-guard` | PASS: no prohibited packages |
| `pnpm build` | PASS: dependency/UI/API/architecture guards and workspace builds completed |

### Remediation Status

All four supplied mobile findings are covered by strict RED → GREEN → Triangle tests and fixed. No review was started, no agents were spawned, and no canonical specs were modified.
