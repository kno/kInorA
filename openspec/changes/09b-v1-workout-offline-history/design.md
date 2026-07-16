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
  - `401`/`403` (session expired/revoked mid-flush, or a membership suspended between enqueue and flush) → `AUTH`: **retryable, entry stays queued**, surface a "session expired — reload / sign in to sync" notice. NOT poison-dropped — the mutation itself may be perfectly valid; only the ambient session went stale.
  - `4xx` from the action/API other than 401/403 (validation, not-found) → poison-message: drop + surface to the user, entry cleared.
  - `stale_action_reference` (web only — see dedicated Decision below) → neither retry-forever nor drop; surface "reload to sync", entry **stays queued**.

**Judgment Day PR4 correction — poison-drop MUST surface to the user**: The original implementation removed a poison-dropped (`VALIDATION`/`NOT_FOUND`) entry from the local queue identically to a synced entry, with **zero UI feedback** — the user's change silently vanished. Both blind judges confirmed this as a data-loss/data-integrity defect (the design always said "drop + surface", but only the drop half was implemented). Fixed: `runSequentialFlush`'s `dropped` list is threaded into hook state (`syncNotice: "dropped"`) and rendered as a visible notice in `PlanTrackerClient`/`PlanStatusClient` (localized via the i18n catalog, `tracker.sync.dropped`). The `AUTH` code above was added for the same reason: the original taxonomy bucketed ALL non-404 4xx (including 401/403) into `VALIDATION`, poison-dropping a mutation whose only problem was an expired/revoked session — `runSequentialFlush` now reports a `haltCode` so the caller can distinguish `AUTH` (surface + keep queued) from a generic retry.

**Judgment Day PR4 correction — flush reentrancy guard**: `flush()` is invoked from 3 independent triggers (the connectivity "online" subscriber, the end of `handleRecordSet`, and `handleCompleteWorkout`) with no coordination between them. The original implementation had no reentrancy guard, so overlapping triggers could run `runSequentialFlush` concurrently — breaking the "strictly sequential, one in-flight" invariant above and risking duplicate/out-of-order network dispatch. Fixed: `use-workout-session.ts` wraps the flush body in a mutex (`isFlushingRef`); a trigger that arrives while a flush is already in-flight sets a "run again once this pass finishes" flag instead of starting a second concurrent pass, so no work introduced mid-flight is missed.

### Decision: Stale Server Action reference on redeploy (web)
**Choice**: A Next.js redeploy that happens between page load and flush can invalidate the client's captured Server Action reference, surfacing as a build-manifest / action-id-not-found error when the browser attempts to invoke it. This is a distinct failure category from `api_unreachable` (it is not a connectivity problem, so retrying without a page reload will never succeed) and from a 4xx poison-message (it is not user input that should be dropped — the mutation is still valid, only the closure reference expired).
**Detection**: `use-workout-session.ts` flush handler inspects the thrown error for the stale-action signature (Next.js server-action-not-found class of error) before falling back to the generic `api_unreachable`/4xx branches.
**Handling**: On detection, keep the queued entries untouched (no loss), stop attempting flush, and surface a "reload to sync" prompt; a page reload re-establishes fresh Server Action references and the existing queue then flushes normally on the next online transition.

### Decision: Error discrimination through the Server Actions / API client boundary
**Choice**: `unwrapWorkoutSession` in `apps/web/.../actions.ts` currently collapses all Fastify-side failures into a single thrown `Error(message)`, and the mobile API client in `apps/mobile/src/api/workout-session.ts` similarly holds the HTTP status internally but discards it for every case except 409 — neither preserves enough signal to distinguish retry vs poison vs stale-action at the flush call site. Both `unwrapWorkoutSession` (web) and the mobile `workout-session.ts` API client MUST preserve a discriminable error shape — a typed `code: FlushErrorCode` (see Interfaces) alongside the `message` — so `use-workout-session.ts` (web) and the mobile flush handler can route each flush failure to the correct taxonomy branch without string-matching on `message` or relying only on the raw HTTP status.
**Taxonomy clarified**: 401/403 → `AUTH`, retryable (entry stays queued, surfaced, NOT poison-dropped); 4xx validation/not-found (400/404/422, i.e. every other 4xx) → poison (drop the entry + surface to the user); 5xx or any unexpected/non-4xx failure → retryable, treated like `UNREACHABLE` (entry stays queued, do NOT poison-drop); `STALE_ACTION` (web only) → entry stays queued + "reload to sync" prompt.
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

**Judgment Day PR4 correction — web identity key MUST be derived from `(tenantId, userId)`, not the session token**: The web implementation initially derived `identityKey` by hashing the raw session token (`getOfflineIdentityKeyAction` in `apps/web/.../plan/[id]/actions.ts`), documented as a "deliberately scoped-equivalent" deviation from this decision's literal `(tenantId, userId)` key. Both blind judges independently identified this as a CRITICAL, code-verified bug, for two compounding reasons:
  1. **Relogin data loss**: the session token is 32 random bytes (see `apps/api/src/auth/session.ts#generateToken`) that **rotates on every login** — it has no relationship to the account's identity. Hashing it means the SAME user logging out and back in resolves a brand-new `identityKey`, and `ensureIdentityScope` (which purges the *previous* identity's namespace whenever the resolved identity differs from the last-seen one) would silently purge that user's OWN unsynced queue on every relogin, as if it were a different account's data.
  2. **Internal-correlator leak**: the exposed hash was `sha256(token)` — the EXACT same value the API uses internally as the session's `tokenHash`/`SessionId` lookup key (see `apps/api/src/auth/session.ts#computeTokenHash`). Reusing an internal correlator as a client-visible identity key is an unnecessary information-disclosure surface.
**Fix**: `getOfflineIdentityKeyAction` now resolves the caller's **stable** `(tenantId, userId)` via a new authenticated `GET /auth/identity` endpoint (`apps/api/src/routes/auth.ts`, `requireAuth` preHandler, returns `request.authContext`'s `{ tenantId, userId }`) — the web Server Action itself has NO direct DB access (like every other web→api path, it calls the API over HTTP), so it cannot call `resolveAuthContextFromToken` (`apps/api/src/auth/plugin.ts`) directly; this endpoint is the minimal authenticated surface that lets it do so indirectly. The identity key is then `sha256("workout-offline:" + tenantId + ":" + userId)` — the `"workout-offline:"` context prefix means this hash is NOT a bare reuse of any internal correlator, while still being: **stable** across logins/reloads for the same account (no more self-purge), and **distinct** per account (cross-account queues stay isolated, satisfying this decision's original scoping intent). `identity.ts`'s "same-user relogin is a no-op" claim, which was FALSE under the token-hash key, is now actually true.
**Re-verify identity before flush (defense-in-depth)**: with the fix above, cross-account namespacing already prevents a mismatched flush from reading/writing another account's data. As a cheap additional guard (Judge B flagged this as critical; Judge A as INFO — resolved toward implementing it, since it is nearly free), `use-workout-session.ts`'s flush pass re-resolves the current authenticated identity immediately before dispatching and aborts the pass (without dropping anything) if it no longer matches the store's bound identity — covering the edge case of an account switch on a long-lived mounted instance.

**Judgment Day Round-2 correction — flush is gated on `isOnline()`, and the identity recheck is defense-in-depth try/catch'd**: the re-verify-identity fix above introduced a NEW critical regression — `getIdentityKey()` is itself a Server Action (a network round-trip), and `runFlushPass` awaited it as its first statement with no `catch`, while `handleRecordSet`/`handleCompleteWorkout` invoke `void flush()` unconditionally after every enqueue, including while offline. Offline, the Server Action throws (`Failed to fetch`), and since the caller never awaits the returned promise, this surfaced as an **unhandled promise rejection on every offline write** — the mainline offline path, previously untested. Fixed in two parts: (a) `runFlushPass` now checks the SAME `ConnectivityMonitor` instance the reconnect-subscriber effect creates (held in a ref) and returns immediately if `isOnline()` is false, before calling `getIdentityKey()` or anything else network-shaped; offline writes enqueue+snapshot and return without any network call. (b) the identity recheck itself is wrapped in try/catch as defense-in-depth against a transient failure even while nominally online (e.g. a network blip on the recheck alone): a thrown/rejected `getIdentityKey()`, or a resolved-but-`undefined` key, is treated as `UNREACHABLE`/retryable — abort the pass silently, queue stays intact, no unhandled rejection — and is explicitly NOT treated as a confirmed account switch. Only a resolved, defined, DIFFERENT key still triggers the original fix #6 abort-as-mismatch branch.

**Judgment Day Round-2 correction — `clearIdentityScope` also purges the `activeSessionId` pointer**: the previous identity's `${identityKey}:activeSessionId` meta pointer (written by `writeActiveSessionPointer` in `snapshot.ts`) lives outside the `mutations`/`snapshots` key-prefix loop `clearIdentityScope` iterates, so it was left behind on an account switch — fail-safe today (nothing reads a stale identity's pointer) but a per-abandoned-identity storage leak. `clearIdentityScope` now also deletes the purged identity's `activeSessionId` pointer.

**Judgment Day Round-2 correction — transient `syncNotice`s self-clear on a clean empty-queue pass**: `runFlushPass` early-returned on an empty queue *before* the notice-clearing branch, so once `auth_required`/`reload_required` was set, it could only clear via a SUBSEQUENT pass that actually re-flushed and succeeded — a pass that finds the queue already empty (e.g. drained by another tab, or simply re-triggered after the underlying condition resolved) left the notice stuck forever. Fixed: the empty-queue branch now clears `auth_required`/`reload_required` (transient, prompts existed only to unblock a drain that has now happened) while leaving `dropped` sticky (it communicates a PERMANENT data loss that remains true regardless of the queue's current state).

### Decision: Atomic `clientSeq` allocation (Judgment Day PR4 correction)
**Choice**: `nextClientSeq` (`apps/web/.../plan/offline/queue.ts`) originally performed `store.get(lastClientSeqKey)` then `store.put(...)` as TWO SEPARATE IndexedDB transactions. Both judges confirmed this as a CRITICAL, code-verified bug: two concurrent allocations against the SAME identity (e.g. two browser tabs) can both read the same high-water-mark before either writes, so both compute the same "next" `clientSeq` and one mutation silently clobbers the other at the shared key `${identityKey}:${clientSeq}` — a mutation is lost with no error.
**Fix**: The `OfflineStore` port gained a new atomic primitive, `incrementCounter(storeName, key): Promise<number>`, that performs the read-modify-write as a SINGLE indivisible operation:
  - The real idb-backed adapter (`db.ts`) implements it inside one `db.transaction(storeName, "readwrite")` — IndexedDB serializes readwrite transactions against the same object store, so two overlapping calls (even across tabs sharing the same origin's IndexedDB) are queued and cannot interleave.
  - The in-memory test fake (`__test-utils__/in-memory-store.ts`) implements it with no `await` between the read and the write, so the synchronous run-to-completion semantics of a single JS task make interleaving impossible there too.
`nextClientSeq` now delegates to `store.incrementCounter("meta", lastClientSeqKey(identityKey))` instead of a separate get+put. `enqueueMutation` also gained a defense-in-depth guard: it refuses (throws) rather than silently overwrites if a mutation already exists at the allocated key — a belt-and-suspenders check in case a future regression reintroduces a non-atomic allocation path.

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
| `apps/web/.../plan/offline/` + `use-workout-session.ts` | Create/Modify | IndexedDB mutation queue (atomic `clientSeq` via `OfflineStore.incrementCounter`) + session snapshot cache + connectivity + sequential flush via existing actions with a reentrancy mutex, incl. stale-action-reference/AUTH/poison-drop notice surfacing and a pre-flush identity re-verify |
| `apps/web/.../actions.ts` | Modify | `unwrapWorkoutSession` preserves a discriminable error code/shape (not just `Error(message)`) so flush can route retry/poison/stale-action/auth; `getOfflineIdentityKeyAction` derives the identity key from `(tenantId, userId)` (via `fetchAuthIdentity`/`GET /auth/identity`), not the session token |
| `apps/web/src/app/(app)/plan/[id]/tracker-client.ts` | Modify | Preserve/propagate the HTTP status/`FlushErrorCode` it already holds (currently discarded except for 409) up to the flush layer, instead of collapsing it; 401/403 map to `AUTH` (split out of the generic 4xx→VALIDATION bucket); new `fetchAuthIdentity` calls `GET /auth/identity` |
| `apps/api/src/routes/auth.ts` | Modify | New `GET /auth/identity` (`requireAuth`) returning `{ tenantId, userId }` from `request.authContext` — the minimal authenticated surface the web Server Action needs since it has no direct DB access |
| `apps/web/.../PlanTrackerClient.tsx` + `PlanStatusClient.tsx` | Modify | Surface `syncNotice: "auth_required" \| "dropped"` (in addition to the existing `"reload_required"`) as a visible notice, localized via `tracker.sync.auth_required` / `tracker.sync.dropped` |
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
// AUTH (401/403) added in the Judgment Day PR4 correction: split out of the generic 4xx bucket
// because a session expired/revoked mid-flush is retryable (stays queued, surfaced), never poison-dropped.
type FlushErrorCode = "UNREACHABLE" | "STALE_ACTION" | "AUTH" | "VALIDATION" | "NOT_FOUND" | "SERVER";

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
