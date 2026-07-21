# Design: Harden Web Flush Pass Against IndexedDB Failures

## Technical Approach

Mirror mobile's proven `flush()` inner try/catch pattern. Wrap `await runFlushPass()` inside the web `flush()` do/while loop (line 356) with a catch block that swallows. This catches all throw sources inside `runFlushPass` — known (store I/O at entries read, mutation delete, snapshot write, cleanup) and future. The active requirement lives in the delta spec at `openspec/changes/09d-v1-offline-flush-hardening/specs/09d-v1-offline-flush-hardening/spec.md`. Canonical spec synchronization belongs to archive.

No store/API/schema/dependency changes needed.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Try/catch inside `flush()` around `runFlushPass()` (mirror mobile) | Broader catch may mask programming errors | **Chosen** — matches proven mobile pattern, catches all throw paths, simplest |
| Try/catch inside `runFlushPass()` around store I/O only | More targeted, non-store throws still surface | Rejected — harder to maintain parity, misses future store calls |
| Store-level retry logic | Automatic recovery | Rejected — out of scope; a later valid trigger may retry only unacknowledged or not-successfully-removed queued mutations, while post-removal snapshot/cleanup failures are swallowed and do not make acknowledged mutations retryable |

## Queue-Preservation Invariant

The invariant is structural, enforced by operation ordering inside `runFlushPass`. The delta spec defines the precise semantics:

| Throw point | What was already executed | Queue state after catch | Retryable? |
|-------------|--------------------------|------------------------|------------|
| `getQueuedMutations` (entries) | Nothing — early in pass | **Intact** — no mutations touched | Yes — a later valid trigger may retry only unacknowledged or not-successfully-removed queued mutations |
| Identity gate / connectivity | Nothing — early in pass | **Intact** | Yes — a later valid trigger may retry only unacknowledged or not-successfully-removed queued mutations |
| `runSequentialFlush` (network ack) | Nothing — ack failed | **Intact** — no removes attempted | Yes — a later valid trigger may retry only unacknowledged or not-successfully-removed queued mutations |
| `removeMutation` (delete) | Some deletes may have succeeded | **Partially depleted** — already-deleted gone, remaining intact | Yes — a later valid trigger may retry only not-successfully-removed queued mutations |
| `writeSnapshot` (put) | All removes succeeded | **Empty** — mutations already removed | No — acknowledged mutations already absent |
| `clearSnapshot` / `clearActiveSessionPointer` (cleanup) | Removes + snapshot write succeeded | **Empty** — queue drained | No — cleanup pointer stale but queue reflects completed operations |

**Critical ordering**: `removeMutation` (lines 313-314) runs BEFORE `writeSnapshot` (line 319). If `removeMutation` succeeds and `writeSnapshot` throws, acknowledged mutations are already removed — they CANNOT be restored. The snapshot/pointer may be stale; no new recovery mechanism is in scope. The outer catch prevents unhandled rejection.

## Failure-State Table

| Store call | Failure before removal | Failure after removal completes |
|------------|----------------------|-------------------------------|
| `entries()` read | Unacknowledged or not-successfully-removed queued mutation may be retried by a later valid trigger | N/A — entries read happens before any removal |
| `delete("mutations")` | Not-successfully-removed queued mutation may be retried by a later valid trigger | N/A — delete is the removal step |
| `put("snapshots")` | N/A — snapshot write happens after removal | Acknowledged mutations already absent; snapshot stale; NOT retryable |
| `delete("snapshots"/"meta")` cleanup | N/A — cleanup happens after removal + snapshot | Cleanup pointer stale; queue state reflects completed operations; NOT retryable |

## Data Flow

```
void flush() ──→ reentrancy guard ──→ do/while loop
                                          │
                                    try { await runFlushPass() }
                                    catch { /* swallow — see invariant */ }
                                          │
                     ┌────────────────────┤
                     │                    │
              getQueuedMutations     [already guarded
              (entries read)          by identity gate]
                     │
              runSequentialFlush ─── network ack
                     │
              removeMutation ──→ writeSnapshot ──→ cleanup
              (delete)            (put)            (delete)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/web/src/app/(app)/plan/use-workout-session.ts` | Modify | Add try/catch around `await runFlushPass()` inside `flush()` do/while loop (~7 lines) |
| `apps/web/src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts` | Modify | Add regression tests for each store I/O boundary (~150 lines) |

## Exact Code Change

Current `flush()` body (lines 343-361):

```typescript
const flush = useCallback(async () => {
  if (isFlushingRef.current) {
    flushAgainRef.current = true;
    return;
  }
  isFlushingRef.current = true;
  try {
    do {
      flushAgainRef.current = false;
      await runFlushPass();  // ← UNPROTECTED
    } while (flushAgainRef.current);
  } finally {
    isFlushingRef.current = false;
  }
}, [runFlushPass]);
```

Target (add inner try/catch mirroring mobile lines 342-352):

```typescript
const flush = useCallback(async () => {
  if (isFlushingRef.current) {
    flushAgainRef.current = true;
    return;
  }
  isFlushingRef.current = true;
  try {
    do {
      flushAgainRef.current = false;
      try {
        await runFlushPass();
      } catch {
        // Every caller invokes flush() fire-and-forget (void flush())
        // from a synchronous event handler — a rejection here would
        // surface as an unhandled promise rejection on the mainline
        // offline write path. Before removal completes, unacknowledged
        // or not-successfully-removed mutations remain queued and may
        // retry on a later valid trigger; a partial delete may leave
        // the queue partially depleted. After removal completes,
        // snapshot/cleanup failures are swallowed, acknowledged
        // mutations are not retryable, and snapshot/pointer may be
        // stale with no new recovery mechanism.
      }
    } while (flushAgainRef.current);
  } finally {
    isFlushingRef.current = false;
  }
}, [runFlushPass]);
```

## Regression Test Strategy

Four tests, one per distinct `OfflineStore` method boundary:

1. **`entries()` throw** — overrides `store.entries` to throw. Tests the read boundary (`getQueuedMutations`). Assert: zero unhandled rejections, queue intact (mutation still queued), a later valid trigger may retry only unacknowledged or not-successfully-removed queued mutations.

2. **`delete("mutations")` throw** — overrides `store.delete` to throw only for the `mutations` namespace. Tests the post-ack removal boundary (`removeMutation`). Requires the network ack to succeed first. Assert: zero unhandled rejections, not-successfully-removed mutation remains queued.

3. **`put("snapshots")` throw** — overrides `store.put` to throw only for the `snapshots` namespace. Tests the post-ack snapshot-write boundary (`writeSnapshot`). Requires ack + removes to succeed first. Assert: zero unhandled rejections, queue empty (mutations already removed), snapshot stale, NOT retryable.

4. **`delete("snapshots"/"meta")` throw** — overrides `store.delete` to throw only for cleanup namespaces. Tests the post-removal cleanup boundary. Requires ack + removes + snapshot write to succeed first. Assert: zero unhandled rejections, queue empty, cleanup pointer stale, NOT retryable.

Each test follows the mobile pattern at `WorkoutTrackerScreen.offline.test.tsx:301`: register `process.on("unhandledRejection", ...)`, inject flaky store via `openStore`, trigger flush, assert, clean up in `finally`. Flaky stores are built by spreading `realStore` and overriding the target method to throw, keeping non-targeted methods intact.

**Budget**: ~150 lines of test code + ~7 production lines = ~157 total. Well within 400-line review budget.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. Pure code addition (try/catch wrapper) + test addition. No data, schema, or dependency changes.

## Open Questions

None — the change is fully scoped and the pattern is proven by the existing mobile implementation + regression test.

## Review Remediation — 2026-07-20

The successor review identified three deterministic CRITICAL blockers in the web hook. This remediation remains web-only and does not modify the canonical 09b spec or mobile behavior.

| Blocker | Remediation | Regression evidence |
|---------|-------------|---------------------|
| A mounted hook could enqueue or dispatch after an account switch using its old context | Revalidate the current identity immediately before handler-side enqueue or direct mutation; reject the operation with `syncNotice: "auth_required"` when the identity is missing, unavailable, or different | `use-workout-session.offline.test.ts`: record-set enqueue, complete enqueue, and direct start switch cases |
| Collapsed flush removed only representative mutations | Match each acknowledged/dropped collapsed mutation back to every raw queued mutation in the same collapse group before calling `removeMutation` | `use-workout-session.offline.test.ts`: two raw writes for one `setId` are both removed after one server dispatch |
| Snapshot persistence failure after enqueue fell through to direct dispatch | Track enqueue completion; after enqueue succeeds, swallow the persistence failure, retain the queue entry, and surface `reload_required` without invoking the Server Action | `use-workout-session.offline.test.ts`: flaky snapshot `put` leaves one queued mutation and zero direct calls |

The existing storage-I/O catch remains in place. A later valid trigger may retry only mutations that were not acknowledged or not successfully removed; acknowledged mutations removed before a snapshot/cleanup failure are not restored.
