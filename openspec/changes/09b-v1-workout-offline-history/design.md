# Design: Offline Workout Capture, Reconnect Sync & Session History (09b)

## Technical Approach

Client-side **mutation queue over the existing idempotent endpoints** (spec Approach 1), not an event log. Sets/complete are applied optimistically to local UI, persisted to a local queue, and flushed on reconnect through the existing write paths (web Server Actions; mobile direct API). Pure queue-collapse and history aggregation live in `packages/domain`; DTOs in `packages/contracts`. History is a standalone read slice that never touches the queue. Strict TDD: pure logic and repo/route changes are test-first.

## Architecture Decisions

### Decision: Web offline path relays through existing Server Actions
**Choice**: Browser queues mutations in IndexedDB and, on flush, invokes the **existing** `recordWorkoutSetAction` / `completeWorkoutSessionAction`. No new direct browser→API calls, no client tokens.
**Alternatives**: Signed short-lived client tokens + direct API (rejected: widens the security model, out of scope).
**Rationale**: Keeps the httpOnly-cookie model and `"server-only"` `tracker-client.ts` intact. The documented exception is narrow: *"the browser may persist mutations locally and defer invocation of existing Server Actions; it still never calls the Fastify API directly."* Documented in `use-workout-session.ts` header and this ADR.

### Decision: Storage libs — `idb` (web) + AsyncStorage (mobile)
**Choice**: Web `idb` (tiny IndexedDB wrapper); mobile `@react-native-async-storage/async-storage`.
**Alternatives**: Hand-rolled IndexedDB (rejected: boilerplate, error-prone); `expo-sqlite` (rejected: blocked by deps-guard `/sqlite/i`, needs native rebuild, SQL overkill for a bounded queue).
**Rationale**: The queue is a bounded set of pre-known `setId`s + one complete per session — a JSON key-value blob suffices. **Neither `idb` nor `@react-native-async-storage/async-storage` matches any deps-guard prohibited pattern, so NO `deps-guard.mjs` / `.dependency-cruiser.cjs` edit is required.** This choice is deliberately smaller than the proposal's contingency. *If* a reviewer later mandates `expo-sqlite`, the required edit is a new `STORAGE_PATTERNS`/`STORAGE_ALLOWED_WORKSPACES=["apps/mobile"]` block in `deps-guard.mjs` mirroring `CAPACITOR_*`.

### Decision: Connectivity as a shared port type, per-runtime impls
**Choice**: Type-only `ConnectivityMonitor` port in `packages/contracts`; implementations in each app (`navigator.onLine` + `online`/`offline` events on web; `@react-native-community/netinfo` on mobile).
**Rationale**: Contracts is the cross-boundary type home; runtime detection is inherently platform-specific and cannot be shared as code. NetInfo does not match a deps-guard pattern.

### Decision: Queue is FIFO with last-write-wins collapse (pure, in domain)
**Choice**: Monotonic `clientSeq` FIFO; before flush, `collapseQueue()` keeps only the latest entry per `setId`, using **`clientSeq` (not `queuedAt`) as both the primary ordering key and the last-write-wins tie-break** — `clientSeq` is a client-assigned monotonic counter and therefore collision-free, whereas `queuedAt` is wall-clock (`Date.now()`, ~1ms resolution) and can tie under rapid taps. `queuedAt` is retained only for diagnostics/FIFO display, never for ordering decisions. `collapseQueue()` orders `complete` last. Pure functions in `packages/domain/src/offline/`.
**Rationale**: Replay is safe because set PATCH is full-state overwrite (idempotent by construction) and complete is made idempotent server-side. Optimistic UI applies locally, then reconciles with the server response on ack. Entry cleared only after ack.
**Flush ordering invariant**: Flush is **strictly sequential** — one in-flight request at a time, awaiting each ack before dispatching the next entry. Concurrent dispatch (e.g. `Promise.all` over the collapsed queue) is explicitly forbidden, because it is the only way client-side "complete ordered last" is guaranteed to arrive at the server in that same order.
**Failure taxonomy** (per queue entry, evaluated in this order on flush failure):
  - `api_unreachable` (network/offline error) → retry, entry stays queued.
  - `4xx` from the action/API (validation, not-found) → poison-message: drop + surface to the user, entry cleared.
  - `stale_action_reference` (web only — see dedicated Decision below) → neither retry-forever nor drop; surface "reload to sync", entry **stays queued**.

### Decision: Stale Server Action reference on redeploy (web)
**Choice**: A Next.js redeploy that happens between page load and flush can invalidate the client's captured Server Action reference, surfacing as a build-manifest / action-id-not-found error when the browser attempts to invoke it. This is a distinct failure category from `api_unreachable` (it is not a connectivity problem, so retrying without a page reload will never succeed) and from a 4xx poison-message (it is not user input that should be dropped — the mutation is still valid, only the closure reference expired).
**Detection**: `use-workout-session.ts` flush handler inspects the thrown error for the stale-action signature (Next.js server-action-not-found class of error) before falling back to the generic `api_unreachable`/4xx branches.
**Handling**: On detection, keep the queued entries untouched (no loss), stop attempting flush, and surface a "reload to sync" prompt; a page reload re-establishes fresh Server Action references and the existing queue then flushes normally on the next online transition.

### Decision: Error discrimination through the Server Actions / API client boundary
**Choice**: `unwrapWorkoutSession` in `apps/web/.../actions.ts` currently collapses all Fastify-side failures into a single thrown `Error(message)`, and the mobile API client in `apps/mobile/src/api/workout-session.ts` similarly holds the HTTP status internally but discards it for every case except 409 — neither preserves enough signal to distinguish retry vs poison vs stale-action at the flush call site. Both `unwrapWorkoutSession` (web) and the mobile `workout-session.ts` API client MUST preserve a discriminable error shape — a typed `code: FlushErrorCode` (see Interfaces) alongside the `message` — so `use-workout-session.ts` (web) and the mobile flush handler can route each flush failure to the correct taxonomy branch without string-matching on `message` or relying only on the raw HTTP status.
**Taxonomy clarified**: 4xx validation/not-found → poison (drop the entry + surface to the user); 5xx or any unexpected/non-4xx failure → retryable, treated like `UNREACHABLE` (entry stays queued, do NOT poison-drop); `STALE_ACTION` (web only) → entry stays queued + "reload to sync" prompt.
**File Changes note**: `apps/web/.../actions.ts` and `apps/mobile/src/api/workout-session.ts` both require a touch to preserve this status/code (previously `actions.ts` was listed as the only touch, and mobile's client was listed as unchanged); see File Changes table.

### Decision: Idempotent complete via existing status, no new column
**Choice**: In `completeSession`, if the `WHERE status='active'` update affects 0 rows, re-read **scoped by `(tenantId, userId, id)`** — exactly the same scoping `findById` already uses — never an unscoped "re-read by id". If the scoped re-read finds the row and it is already `completed`, return it (200 no-op). Only a row missing **within the caller's own tenant/user scope** → `undefined` → 404.
**Alternatives**: Additive `syncedAt` column (rejected: unnecessary — `status='completed'` is already terminal and last-write-wins). Unscoped re-read by id (rejected: IDOR — would leak/no-op against another tenant's or user's session).
**Rationale**: Smallest possible fix, no migration, route unchanged. This repo already fixed exactly this bug class in `recordSet` (see the documented IDOR BLOCKER comment there); the idempotent-complete re-read must follow the same `(tenantId, userId, id)` scoping as `findById` (`apps/api/src/db/repositories/workout-session.ts`), not a weaker unscoped lookup.

### Decision: `listCompletedSessions` batch-fetches, never loops per-row
**Choice**: `listCompletedSessions(tenantId, userId, { limit, cursor|offset })` executes a **constant, bounded number of queries regardless of page size**: (1) one query for the page of completed sessions scoped by `(tenantId, userId)`; (2) one `inArray(sessionIds)` query across the whole page fetching all `session_exercises` for those sessions; (3) one `inArray(sessionExerciseId)` query fetching all `set_records` for those `session_exercises` (`set_records` has no `sessionId` column — see `apps/api/src/db/schema.ts` — so it can only be reached via the `session_exercises` ids loaded in step 2, never via a direct `inArray(sessionIds)`). Results are grouped in memory by `sessionId` (then `exerciseId`) to reassemble each `WorkoutHistoryEntry`.
**Anti-pattern (explicitly rejected)**: Looping the page of sessions and calling the existing `findById`-style per-row fetch (`apps/api/src/db/repositories/workout-session.ts` ~lines 143-179) once per session — that pattern is correct for a single-session read but is an N+1 query bug at list scale and MUST NOT be replicated in `listCompletedSessions`.
**Rationale**: Keeps history list latency flat as page size grows; the existing single-session `findById` remains the right pattern for its own use case but is not reused as a per-row primitive inside a list.

### Decision: Trend indicator computed via one bounded lookback query, never breaking pagination
**Choice**: Each `WorkoutHistoryEntry.trend` compares **this session vs. the immediately-prior completed session for the same plan/exercise scope**. To give the *oldest* item on a page a prior-session comparison without fetching unbounded history, `listCompletedSessions` issues **one additional bounded lookback query**: either `LIMIT (n+1)` on the underlying ordered scan (fetch one row past the page window) when the lookback session is contiguous with the page, or a secondary single-row query scoped by `(tenantId, userId, planId)` ordered before the oldest page item when it is not. This keeps the query count constant (bounded, independent of page size) — no N+1, no full-history scan. The pure `computeVolumeTrend(current, prior)` in `packages/domain` then derives `volumeDelta`/`direction` from the two already-fetched sessions; the route/repository layer only supplies the pair, all comparison logic stays pure and testable.
**Rationale**: Satisfies the spec's trend-indicator requirement while preserving the flat, bounded-query-count guarantee established by the batch-fetch decision above.

### Decision: Local store persists a session snapshot, not only the mutation queue
**Choice**: In addition to the `PendingMutation` diff queue, the local store (idb on web, AsyncStorage on mobile) persists a cached `WorkoutSessionRecord` **snapshot** of the currently-active session, keyed by `sessionId`. The snapshot is written (a) once when the session is first loaded (online) and (b) after every optimistic mutation is applied locally, so it always reflects "server state as last known + queued mutations applied". On offline reload/app restart, the tracker hydrates its UI directly from the cached snapshot with any still-queued `PendingMutation`s re-applied on top — **without requiring a network GET**.
**Rationale**: This is required to satisfy the spec's literal "offline data survives reload" scenario: a `PendingMutation` queue alone only replays *diffs* against the server and gives the UI nothing to render from if the app is reloaded while offline (no snapshot, no network, no data to show). The snapshot is the read-side complement to the queue's write-side.
**Rationale (2)**: Snapshot + queue-replay-on-top is deliberately simple (no CRDT/merge logic) because the queue is already the single source of truth for pending writes; the snapshot is a cache, not a second source of truth — on reconnect, the server ack always wins and overwrites the cached snapshot.
**Complete-mutation semantics**: Enqueuing a `complete` `PendingMutation` optimistically flips the cached snapshot's `session.status` to `"completed"` at the same time the mutation is enqueued. This means an offline reload/restart that happens after the user taps "Complete" but before reconnect renders the session as completed — consistent with the optimistic UI — even though the server has not yet acknowledged it. On ack, the snapshot is refreshed from the server response as usual (no behavior change there).
**Eviction/cleanup policy**: The cached snapshot for a session is cleared once that session is both completed AND fully synced (its queue has no remaining entries for that `sessionId`), and unconditionally on logout (see cross-identity scoping decision below). This bounds local storage growth and prevents a stale completed-session snapshot from lingering after sync.

### Decision: Local store is scoped per authenticated identity and cleared on logout
**Choice**: Both the `PendingMutation` queue and the `WorkoutSessionSnapshot` cache are namespaced by the authenticated identity — keyed under `(tenantId, userId)` (e.g. an idb/AsyncStorage key prefix such as `offline:${tenantId}:${userId}:...`) rather than a single global key. On logout or account switch, the store for the previously-active identity's namespace MUST be cleared (queue and snapshot both).
**Rationale**: This is a shared-device scenario (e.g. a gym kiosk/tablet) safeguard — without per-identity scoping and logout cleanup, a mutation queued under one account could flush under a different account's token after a subsequent login, silently writing data to the wrong user's session. Scoping lives at the local-store key-namespace layer in `apps/web/.../plan/offline/` and `apps/mobile/.../offline/`, the same modules already listed in File Changes for the queue/snapshot implementation.

## Data Flow

    UI action ─► optimistic local state ─► enqueue mutation (idb/AsyncStorage, durable) ─► write session snapshot (idb/AsyncStorage)
                                              │
              ConnectivityMonitor "online" ──► collapseQueue() ─► existing action/API ─► ack ─► clear entry ─► refresh snapshot from ack
    Offline reload/restart: read session snapshot ─► apply queued PendingMutations on top ─► render  (no network GET required)
    History: UI ─► action/API ─► completed sessions ─► domain aggregates ─► render  (queue-independent)

**Write-order invariant**: The durable **enqueue** of the `PendingMutation` always happens **before** the snapshot write, never after. A crash between enqueue and snapshot write is self-healing — the queue is replayed on next load and the snapshot is regenerated from it. The reverse order (snapshot-then-enqueue) is unsafe: a crash after the snapshot write but before the enqueue completes would leave a cached snapshot showing a mutation that was never durably queued, silently losing it on reconnect since nothing remains to flush. The queue is therefore always the source of truth and must never lead the snapshot.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/.../repositories/workout-session.ts` | Modify | Idempotent, tenant/user-scoped `completeSession`; new batch-fetching `listCompletedSessions` (no per-row loop) |
| `apps/api/src/routes/workout-session.ts` | Modify | `GET /workout-sessions/history` (injected repo port, paginated query DTO, includes per-entry `trend` via the bounded one-extra-lookback-session query) |
| `packages/contracts/src/index.ts` | Modify | `PendingMutation`, `ConnectivityMonitor`, `WorkoutHistoryEntry`, `WorkoutSessionSnapshot`, `WorkoutHistoryQuery` DTOs |
| `packages/domain/src/offline/` | Create | Pure `collapseQueue` (clientSeq-ordered LWW, sequential-flush-ready); `computeSessionVolume`/`computeAverageRpe`/`computeVolumeTrend` |
| `packages/domain/src/plan/index.ts` (or new barrel) | Modify | Export aggregation/collapse |
| `apps/web/.../plan/offline/` + `use-workout-session.ts` | Create/Modify | IndexedDB mutation queue + session snapshot cache + connectivity + sequential flush via existing actions, incl. stale-action-reference detection |
| `apps/web/.../actions.ts` | Modify | `unwrapWorkoutSession` preserves a discriminable error code/shape (not just `Error(message)`) so flush can route retry/poison/stale-action |
| `apps/web/src/app/(app)/plan/[id]/tracker-client.ts` | Modify | Preserve/propagate the HTTP status/`FlushErrorCode` it already holds (currently discarded except for 409) up to the flush layer, instead of collapsing it |
| `apps/web/.../history/` | Create | History route/tab + `getWorkoutHistoryAction` (paginated) |
| `apps/mobile/.../offline/` + `WorkoutTrackerScreen.tsx` | Create/Modify | AsyncStorage mutation queue + session snapshot cache + NetInfo + sequential flush |
| `apps/mobile/src/api/workout-session.ts` | Modify | Preserve/propagate the HTTP status/`FlushErrorCode` it already holds (currently discarded except for 409) up to the flush layer, instead of collapsing it |
| `apps/mobile/src/screens/HistoryScreen.tsx` + api client | Create/Modify | History surface + `getWorkoutHistory` (paginated) |

## Interfaces / Contracts

```ts
type PendingMutation =
  // clientSeq is the monotonic, collision-free ordering + LWW tie-break key (persisted across restart).
  // queuedAt (wall-clock) is diagnostics/FIFO-display only — never used for ordering decisions.
  | { kind: "set"; sessionId: string; setId: string; input: WorkoutSetUpdateInput; queuedAt: number; clientSeq: number }
  | { kind: "complete"; sessionId: string; queuedAt: number; clientSeq: number };
interface ConnectivityMonitor { isOnline(): boolean; subscribe(cb: (online: boolean) => void): () => void; }
// trend compares THIS session vs. the immediately-prior completed session for the same plan/exercise
// scope; undefined when there is no prior session (e.g. first session in the plan/scope).
interface WorkoutHistoryEntry {
  session: WorkoutSessionRecord;
  totalVolume: number;
  averageRpe?: number;
  trend?: { volumeDelta: number; direction: "up" | "down" | "flat" };
}

// Discriminated flush-failure taxonomy, threaded through unwrapWorkoutSession (web) and the
// mobile workout-session.ts API client so use-workout-session.ts / the mobile flush handler can
// route without string-matching on `message`.
type FlushErrorCode = "UNREACHABLE" | "STALE_ACTION" | "VALIDATION" | "NOT_FOUND" | "SERVER";

// Local-store snapshot cache (idb / AsyncStorage), read-side complement to PendingMutation queue.
interface WorkoutSessionSnapshot { sessionId: string; session: WorkoutSessionRecord; cachedAt: number; }

// Pagination contract for GET /workout-sessions/history — offset-based, default page size 20.
interface WorkoutHistoryQuery { limit?: number /* default 20 */; offset?: number /* default 0 */; }
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (domain) | collapse LWW/ordering, volume/RPE/trend | Vitest pure, `packages/domain/**/__tests__` |
| Unit (client) | queue persist/flush, connectivity, optimistic reconcile | injected fake storage + fetch/action mocks |
| Integration (api) | idempotent complete retry, history endpoint | Fastify `.inject()`, mocked Drizzle |
| E2E (manual) | offline→reload→reconnect sync | dev-only checklist |

## Migration / Rollout
No migration. Additive, revert-per-slice (queue is client-only; complete-fix isolated; history removable).

## Open Questions
- [ ] `size:exception` vs chained PRs — this touches api+domain+contracts+web+mobile. Recommend 4 slices: (1) idempotent complete, (2) history, (3) web offline, (4) mobile offline. **400-line budget risk: High.** Defer final call to sdd-tasks.

History pagination is decided (no longer open) — see `WorkoutHistoryQuery` in Interfaces: offset-based (`limit`/`offset`), default `limit=20`, both tunable by the caller.

`clientSeq` persistence: the monotonic `clientSeq` counter (or an equivalent monotonic surrogate, e.g. a persisted `lastClientSeq` high-water-mark) is itself persisted in the local store across app restart, so mutations queued before a restart keep correct relative order against mutations queued after — never reset to 0 on load.
