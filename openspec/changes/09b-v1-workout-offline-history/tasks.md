# Tasks: Offline Workout Capture, Reconnect Sync & Session History (09b)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1450-1650 total (see per-slice below) |
| 400-line budget risk | High (overall); Low-Medium per slice |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (idempotent complete) → PR 2 (history) → PR 3 (shared offline contracts + web offline) → PR 4 (mobile offline) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Per-Slice Estimate

| Slice | Est. lines (code+tests) | Risk | Independent? |
|-------|--------------------------|------|--------------|
| 1. Idempotent complete | ~120-180 | Low | Yes |
| 2. Session history | ~350-450 | Medium | Yes |
| 3. Shared contracts + web offline | ~600-700 | High | Depends on domain/contracts (can land contracts first) |
| 4. Mobile offline | ~380-450 | Medium | Depends on slice 3 contracts |

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Idempotent `completeSession` | PR 1 | Independent, low-risk, ship first |
| 2 | `listCompletedSessions` + history endpoint + trend | PR 2 | Independent of offline queue; can parallel PR 1 |
| 3 | `packages/contracts` DTOs + `packages/domain` pure functions + web offline (idb, snapshot, flush, error taxonomy) + web history UI | PR 3 | Depends on PR 1 (idempotent complete is the flush target) and shared contracts/domain landing first within this slice |
| 4 | Mobile offline (AsyncStorage, NetInfo, flush) + mobile history UI | PR 4 | Depends on contracts/domain from PR 3 |

Ask the user: chain strategy (stacked-to-main vs feature-branch-chain) before `sdd-apply` starts PR 3/4, given High overall budget risk.

## Phase 1: Contracts & Domain (Foundation — shared by slices 3 & 4)

- [ ] 1.1 RED: Write failing tests for `PendingMutation`, `WorkoutSessionSnapshot`, `ConnectivityMonitor`, `WorkoutHistoryEntry`, `WorkoutHistoryQuery`, `FlushErrorCode` type contracts in `packages/contracts/src/index.ts` (compile-level/type tests)
- [ ] 1.2 GREEN: Add DTOs/types to `packages/contracts/src/index.ts` per design Interfaces section
- [ ] 1.3 RED: Write failing Vitest tests for `collapseQueue` (clientSeq-keyed LWW, complete-ordered-last) in `packages/domain/src/offline/__tests__/`
- [ ] 1.4 GREEN: Implement `collapseQueue` in `packages/domain/src/offline/`
- [ ] 1.5 RED: Write failing tests for `computeSessionVolume`, `computeAverageRpe`, `computeVolumeTrend`
- [ ] 1.6 GREEN: Implement `computeSessionVolume`, `computeAverageRpe`, `computeVolumeTrend` in `packages/domain/src/offline/`
- [ ] 1.7 REFACTOR: Extract shared helpers, export via `packages/domain/src/plan/index.ts` barrel
- [ ] 1.8 Run `pnpm architecture` to confirm no deps-guard violation (idb/AsyncStorage/NetInfo not yet imported at this phase — sanity baseline)

## Phase 2: Idempotent Complete (Slice 1 — PR 1)

- [ ] 2.1 RED: Write failing integration test — retry `completeSession` after success returns 200 no-op, tenant/user-scoped re-read matches `findById` scoping (`apps/api/src/db/repositories/workout-session.ts` tests)
- [ ] 2.2 RED: Write failing test — scoped re-read across a different tenant/user returns 404 (no IDOR)
- [ ] 2.3 GREEN: Modify `completeSession` in `apps/api/src/db/repositories/workout-session.ts` — on 0-row update, re-read scoped by `(tenantId, userId, id)`; return existing row if already `completed`
- [ ] 2.4 RED: Write failing Fastify `.inject()` test for `POST /workout-sessions/:id/complete` retry-after-success
- [ ] 2.5 GREEN: Confirm route in `apps/api/src/routes/workout-session.ts` requires no change (repo-level fix only); verify tests pass
- [ ] 2.6 REFACTOR: Confirm no route/schema drift; run `pnpm test` scoped to api workspace

## Phase 3: Session History (Slice 2 — PR 2)

- [ ] 3.1 RED: Write failing tests for `listCompletedSessions` — batched `inArray` fetch, constant query count regardless of page size, no per-row loop
- [ ] 3.2 GREEN: Implement `listCompletedSessions(tenantId, userId, { limit, offset })` in `apps/api/src/db/repositories/workout-session.ts` (session query → `inArray(sessionIds)` for `session_exercises` → `inArray(sessionExerciseId)` for `set_records`, grouped in memory)
- [ ] 3.3 RED: Write failing test — trend lookback query returns prior session for oldest page item without breaking pagination or adding N+1 queries
- [ ] 3.4 GREEN: Implement bounded lookback (`LIMIT n+1` or secondary single-row query) feeding `computeVolumeTrend`
- [ ] 3.5 RED: Write failing Fastify `.inject()` test for `GET /workout-sessions/history` with `WorkoutHistoryQuery` (default `limit=20`, `offset=0`), asserting `trend` field present per entry
- [ ] 3.6 GREEN: Implement route in `apps/api/src/routes/workout-session.ts` (injected repo port, paginated query DTO)
- [ ] 3.7 RED: Write failing web test for `getWorkoutHistoryAction` (paginated Server Action) in `apps/web/.../history/`
- [ ] 3.8 GREEN: Implement history route/tab + `getWorkoutHistoryAction` in `apps/web/.../history/`
- [ ] 3.9 RED: Write failing test for mobile `HistoryScreen.tsx` + `getWorkoutHistory` api client call
- [ ] 3.10 GREEN: Implement `apps/mobile/src/screens/HistoryScreen.tsx` + api client method
- [ ] 3.11 REFACTOR: Confirm history rendering works with empty/unavailable offline queue (spec: "History available without pending sync activity")

## Phase 4: Web Offline (Slice 3 — PR 3, depends on Phase 1 & 2)

- [ ] 4.1 RED: Write failing test — `unwrapWorkoutSession` in `apps/web/.../actions.ts` preserves `FlushErrorCode` (not just `Error(message)`)
- [ ] 4.2 GREEN: Modify `unwrapWorkoutSession` to return discriminated error shape
- [ ] 4.3 RED: Write failing test — `tracker-client.ts` propagates HTTP status/`FlushErrorCode` beyond the existing 409-only case
- [ ] 4.4 GREEN: Modify `apps/web/src/app/(app)/plan/[id]/tracker-client.ts` to preserve/propagate status/code
- [ ] 4.5 RED: Write failing tests for idb-backed `PendingMutation` queue persistence (enqueue-before-snapshot ordering) in `apps/web/.../plan/offline/`
- [ ] 4.6 GREEN: Implement idb queue module with `clientSeq` persistence across restart (`lastClientSeq` high-water-mark)
- [ ] 4.7 RED: Write failing tests for `WorkoutSessionSnapshot` cache read/write, eviction on complete+synced, clear-on-logout
- [ ] 4.8 GREEN: Implement snapshot cache module, identity-scoped key namespace `offline:${tenantId}:${userId}:...`
- [ ] 4.9 RED: Write failing tests for `ConnectivityMonitor` web impl (`navigator.onLine` + online/offline events)
- [ ] 4.10 GREEN: Implement web `ConnectivityMonitor` in `apps/web/.../plan/offline/`
- [ ] 4.11 RED: Write failing tests for sequential flush in `use-workout-session.ts` — one in-flight request at a time, `collapseQueue()` applied before flush, complete ordered last
- [ ] 4.12 GREEN: Implement flush loop in `use-workout-session.ts` invoking existing `recordWorkoutSetAction`/`completeWorkoutSessionAction`
- [ ] 4.13 RED: Write failing tests for stale-action-reference detection (distinct from `api_unreachable`/4xx) surfacing "reload to sync" prompt, entry stays queued
- [ ] 4.14 GREEN: Implement stale-action detection branch in flush handler
- [ ] 4.15 RED: Write failing tests — offline reload hydrates UI from snapshot + replays queued mutations without network GET
- [ ] 4.16 GREEN: Wire snapshot hydration into tracker page load path
- [ ] 4.17 RED: Write failing test — logout clears identity-scoped queue + snapshot
- [ ] 4.18 GREEN: Implement clear-on-logout hook
- [ ] 4.19 Run `pnpm architecture` to confirm `idb` import does not trip deps-guard (per design: no edit expected)
- [ ] 4.20 REFACTOR: Consolidate offline module structure under `apps/web/.../plan/offline/`; run `pnpm type-check` and `pnpm test` for web workspace

## Phase 5: Mobile Offline (Slice 4 — PR 4, depends on Phase 1 & 4 contracts)

- [ ] 5.1 RED: Write failing test — `apps/mobile/src/api/workout-session.ts` preserves `FlushErrorCode` beyond existing 409-only case
- [ ] 5.2 GREEN: Modify mobile API client to propagate discriminated error shape
- [ ] 5.3 RED: Write failing tests for AsyncStorage-backed `PendingMutation` queue (enqueue-before-snapshot, `clientSeq` persistence across restart) in `apps/mobile/.../offline/`
- [ ] 5.4 GREEN: Implement AsyncStorage queue module
- [ ] 5.5 RED: Write failing tests for `WorkoutSessionSnapshot` cache (mobile), eviction, clear-on-logout, identity-scoped keys
- [ ] 5.6 GREEN: Implement mobile snapshot cache module
- [ ] 5.7 RED: Write failing tests for `ConnectivityMonitor` mobile impl (`@react-native-community/netinfo`)
- [ ] 5.8 GREEN: Implement mobile `ConnectivityMonitor`
- [ ] 5.9 RED: Write failing tests for sequential flush in `WorkoutTrackerScreen.tsx` — collapseQueue applied, one in-flight request, complete ordered last, direct API calls
- [ ] 5.10 GREEN: Implement mobile flush loop invoking direct API via `apps/mobile/src/api/workout-session.ts`
- [ ] 5.11 RED: Write failing tests — offline restart hydrates UI from snapshot + replays queued mutations without network call
- [ ] 5.12 GREEN: Wire snapshot hydration into `WorkoutTrackerScreen.tsx` mount
- [ ] 5.13 RED: Write failing test — logout clears identity-scoped mobile queue + snapshot
- [ ] 5.14 GREEN: Implement clear-on-logout hook (mobile)
- [ ] 5.15 Run `pnpm architecture` to confirm NetInfo/AsyncStorage do not trip deps-guard
- [ ] 5.16 REFACTOR: Consolidate `apps/mobile/.../offline/` module structure; run `pnpm type-check` and `pnpm test` for mobile workspace

## Phase 6: Cross-Cutting Verification

- [ ] 6.1 Run full `pnpm test`, `pnpm type-check`, `pnpm architecture` across all workspaces
- [ ] 6.2 Manual E2E checklist: offline log sets → reload → still visible; reconnect → syncs exactly once; concurrent edits to same setId resolve LWW by clientSeq; complete-after-success retry succeeds; history renders with queue empty/unavailable
- [ ] 6.3 Confirm each PR slice is independently revertable per design's Migration/Rollout note (no migration; additive)
