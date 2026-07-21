## Exploration: Harden offline runFlushPass against IndexedDB / AsyncStorage failures

### Current State

**Web (`apps/web/src/app/(app)/plan/use-workout-session.ts`)**: `runFlushPass` (lines 232-341) gates on connectivity (line 244-247) and wraps the identity recheck in try/catch (lines 259-267), per Judgment Day Round-2 fix #1. However, the store I/O calls *after* these gates are **not individually wrapped**:

- `getQueuedMutations` (line 281) — calls `store.entries("mutations")`, can throw on IndexedDB quota, Safari ITP eviction, or DB corruption.
- `removeMutation` (lines 313-314) — calls `store.delete("mutations", ...)`, can throw.
- `writeSnapshot` (line 319) — calls `store.put("snapshots", ...)`, can throw.
- `clearSnapshot` / `clearActiveSessionPointer` (lines 323-324) — calls `store.delete("snapshots"/"meta", ...)`, can throw.
- The `flush()` wrapper (lines 343-361) does **NOT** wrap `runFlushPass` in try/catch. Since all three callers invoke `void flush()` fire-and-forget, a thrown store I/O error becomes an **unhandled promise rejection**.

**Mobile (`apps/mobile/src/screens/WorkoutTrackerScreen.tsx`)**: The identical store I/O calls in `runFlushPass` (lines 264-331) are similarly unprotected. **However**, the `flush()` wrapper (lines 333-357) wraps `runFlushPass` in try/catch (line 343) with a clear comment: "a transient failure (storage I/O, an unexpected throw from the API client) must never propagate." Mobile already has a regression test (`WorkoutTrackerScreen.offline.test.tsx:301`) that verifies zero unhandled rejections from a throwing store mid-flush.

**Conclusion**: The web side still has the **live gap**. Mobile is already protected by the `flush()` try/catch, which the previous Judgment Day fixes added.

### Remaining Gap (Web Only)

| Dimension | Status |
|-----------|--------|
| Web `runFlushPass` store I/O throws → unhandled rejection | **UNFIXED** |
| Mobile `runFlushPass` store I/O throws → unhandled rejection | **FIXED** (via `flush()` try/catch, test at `WorkoutTrackerScreen.offline.test.tsx:301`) |
| Web regression test for throwing store mid-flush | **MISSING** |
| Mobile regression test for throwing store mid-flush | **EXISTS** |
| Spec requirement for "graceful degradation under storage I/O failure" | **CAPTURED** (delta spec at `openspec/changes/09d-v1-offline-flush-hardening/specs/09d-v1-offline-flush-hardening/spec.md`) |

### Affected Areas

| File | Impact |
|------|--------|
| `apps/web/src/app/(app)/plan/use-workout-session.ts` | Add try/catch around `runFlushPass` inside `flush()` do/while loop (mirror mobile's pattern) |
| `apps/web/src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts` | Add regression test: store double that throws `entries()` mid-flush, verify queue intact + zero unhandled rejections |
| `openspec/changes/09d-v1-offline-flush-hardening/specs/09d-v1-offline-flush-hardening/spec.md` | Delta spec already captures the "Storage I/O Failure Resilience" requirement; canonical spec synchronization deferred to archive |

### Non-Goals

- No store-level retry logic — a later valid trigger (connectivity change, next enqueue) may retry only unacknowledged or not-successfully-removed queued mutations; post-removal snapshot/cleanup failures do not make acknowledged mutations retryable.
- No queue durability improvement — the queue is already persisted atomically (enqueue-first invariant).
- No mobile changes needed — already protected.
- No new snapshot recovery mechanism — snapshot/pointer may be stale after a post-ack failure; no new recovery mechanism is in scope.
- No canonical spec modification — deferred to archive phase.

### Queue-Preservation Invariant (Precise)

No mutation is removed before successful server acknowledgement. If `removeMutation` throws after some deletions have succeeded, the successfully removed acknowledged mutations may be absent from the queue, while each not-successfully-removed mutation remains queued and may be retried by a later trigger. The queue is NOT guaranteed fully intact when `removeMutation` itself fails mid-operation.

| Throw point | What was already executed | Queue state after catch | Retryable? |
|-------------|--------------------------|------------------------|------------|
| `getQueuedMutations` (entries) | Nothing — early in pass | **Intact** — no mutations touched | Yes — next valid trigger retries only unacknowledged or not-successfully-removed queued mutations |
| Identity gate / connectivity | Nothing — early in pass | **Intact** | Yes — next valid trigger retries only unacknowledged or not-successfully-removed queued mutations |
| `runSequentialFlush` (network ack) | Nothing — ack failed | **Intact** — no removes attempted | Yes — next valid trigger retries only unacknowledged or not-successfully-removed queued mutations |
| `removeMutation` (delete) | Some deletes may have succeeded | **Partially depleted** — already-deleted gone, remaining intact | Yes — not-successfully-removed mutations retry |
| `writeSnapshot` (put) | All removes succeeded | **Empty** — mutations already removed | No — acknowledged mutations already absent |
| `clearSnapshot` / `clearActiveSessionPointer` (cleanup) | Removes + snapshot write succeeded | **Empty** — queue drained | No — cleanup pointer stale but queue reflects completed operations |

If a failure occurs after `removeMutation` completes (during `writeSnapshot` or cleanup), the acknowledged mutation is already absent from the queue and is NOT retryable. Snapshot/pointer may be stale; no new recovery mechanism is in scope.

### Approaches

1. **Add try/catch around `runFlushPass` inside `flush()` (mirror mobile)** — add an inner try/catch at web's `flush()` lines 356-361 identical to mobile's lines 342-352.
   - Pros: Simple, matches existing mobile pattern exactly, catches ALL throw sources inside runFlushPass.
   - Cons: Broader catch may mask programming errors (but the existing architecture already treats queue integrity as the invariant — a failed pass never drops unacknowledged data).
   - Effort: Low (~7 line code change + ~60 line test)

2. **Add try/catch inside `runFlushPass` around store I/O calls only** — wrap the post-gate block (lines 281-340) in try/catch.
   - Pros: More targeted — non-store throws (programming errors) still surface.
   - Cons: More complex, harder to maintain parity with mobile, could miss a future store call added inside runFlushPass.
   - Effort: Low (~10 line code change + ~60 line test)

### Recommendation

**Approach 1** (mirror mobile's `flush()` inner try/catch). The mobile pattern is already proven by an existing regression test. It maintains cross-platform parity, catches all throw paths (known and future), and is the simplest fix. The queue-preservation invariant is enforced by operation ordering — no unacknowledged mutation is removed (retryable); post-ack failures are safely caught without unhandled rejection and queue state reflects completed operations (not retryable, snapshot stale).

### Risks

- **Post-ack failures leave queue depleted**: If `removeMutation` succeeds (mutation acknowledged and removed) but `writeSnapshot` or cleanup throws, the acknowledged mutation is already absent and NOT retryable. Snapshot/pointer may be stale; no new recovery mechanism is in scope.
- **Partial delete race**: If `removeMutation` throws mid-operation (some deletes succeeded, some failed), not-successfully-removed mutations remain queued and WILL be retried. Successfully removed acknowledged mutations are absent. The catch prevents unhandled rejection.
- **Masked programming errors**: A genuine programming error thrown inside `runFlushPass` would be silently swallowed. Mitigated by the fact that this is an async fire-and-forget path: the current behavior (unhandled rejection) is strictly worse. Acceptable for this scope.

### Ready for Proposal

**Yes** — the change is well-scoped to web only, with a clear fix (mirror mobile's `flush()` inner try/catch) and a clear test pattern (mirror mobile's throwing-store regression test). The active requirement is captured in the delta spec at `openspec/changes/09d-v1-offline-flush-hardening/specs/09d-v1-offline-flush-hardening/spec.md`; canonical spec synchronization is archive-only. The orchestrator should tell the user: web alone needs the fix; mobile is already protected.

---

## Result Contract

**Status**: success
**Executive Summary**: Corrected exploration artifact for `09d-v1-offline-flush-hardening`. Updated spec routing to active delta spec, stated precise partial-delete semantics, clarified stale-snapshot scope, removed imprecise queue-intact claims, and added the required return envelope.
**Artifacts**: `openspec/changes/09d-v1-offline-flush-hardening/exploration.md`
**Next**: sdd-tasks (proposal, spec, and design are already complete)
**Risks**: None beyond those documented in the exploration
**Skill Resolution**: paths-injected — 2 skills (sdd-explore, sdd-phase-common)
