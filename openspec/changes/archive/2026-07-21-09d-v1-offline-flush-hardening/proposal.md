# Proposal: Harden Web Flush Pass Against IndexedDB Failures

## Source Artifact

The active delta spec is the source of truth for this change:
`openspec/changes/09d-v1-offline-flush-hardening/specs/09d-v1-offline-flush-hardening/spec.md`

Canonical spec synchronization (`openspec/specs/09b-v1-workout-offline-history/spec.md`) belongs to the archive phase. This proposal and its delta spec do NOT modify the canonical spec.

## Intent

Web's `runFlushPass` store I/O calls (getQueuedMutations, removeMutation, writeSnapshot, clearSnapshot, clearActiveSessionPointer) are not wrapped in try/catch. When IndexedDB throws (quota exceeded, Safari ITP eviction, DB corruption), the error propagates as an unhandled promise rejection through the fire-and-forget `flush()` callers. Mobile is already protected by a `flush()` inner try/catch (added in Judgment Day Round-2). This fix brings web to parity.

## Scope

### In Scope
- Add try/catch around `runFlushPass` inside web's `flush()` do/while loop, mirroring mobile's pattern
- Add four focused boundary regression tests (store doubles sharing helpers/fixtures): `entries()` throw, `delete("mutations")` throw, `put("snapshots")` throw, `delete("snapshots"/"meta")` throw — each verifying zero unhandled rejections and correct queue state per the invariant table
- Delta spec captures the "Storage I/O Failure Resilience" requirement for the 09b domain

### Out of Scope
- Mobile changes (already protected, regression test exists)
- Canonical spec modification (deferred to archive)
- Store-level retry logic (a later valid trigger may retry only unacknowledged or not-successfully-removed queued mutations; post-removal snapshot/cleanup failures are swallowed and do not make acknowledged mutations retryable; valid triggers are connectivity change or next enqueue)
- Queue durability improvements (already atomic via enqueue-first invariant)

## Queue Invariant (Precise)

No mutation is removed before successful server acknowledgement. If `removeMutation` throws before all deletes complete, the not-successfully-removed mutations remain queued and retryable; successfully removed acknowledged mutations are absent. If `removeMutation` succeeds and a later `writeSnapshot` or cleanup call throws, the acknowledged mutation is already absent from the queue — the state is NOT retryable for that mutation (it was already ack'd and removed). The outer catch prevents unhandled rejection. Snapshot/pointer may be stale; no new recovery mechanism is in scope.

## Capabilities

### New Capabilities
None

### Modified Capabilities
None — the delta spec already exists at `openspec/changes/09d-v1-offline-flush-hardening/specs/09d-v1-offline-flush-hardening/spec.md` and captures the requirement. No new delta spec needs to be created by sdd-spec.

## Approach

Mirror mobile's proven pattern exactly. Wrap the `runFlushPass` call inside the web `flush()` do/while loop (lines 356-361 of `use-workout-session.ts`) with a try/catch that logs and swallows the error. This catches all throw sources inside runFlushPass (known and future). The queue-preservation invariant is enforced by operation ordering: `removeMutation` only runs after a successful ack, so a thrown pass before ack never drops data.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/web/src/app/(app)/plan/use-workout-session.ts` | Modified | Add try/catch around `runFlushPass` inside `flush()` (~7 lines) |
| `apps/web/src/app/(app)/plan/__tests__/use-workout-session.offline.test.ts` | Modified | Add regression test: throwing store mid-flush (~150 lines) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Masked programming errors inside runFlushPass | Low | Acceptable: current behavior (unhandled rejection) is strictly worse. Later valid triggers retry only unacknowledged or not-successfully-removed queued mutations; post-removal snapshot/cleanup failures are swallowed but do not make acknowledged mutations retryable. |
| Cross-platform parity drift in future | Low | Regression test catches regressions; delta spec enforces the invariant until archive merges. |

## Rollback Plan

Revert the two changed files via `git checkout HEAD~1` on each. No data migration, schema changes, or canonical spec modifications involved — pure code + test addition.

## Dependencies

None beyond the existing codebase.

## Success Criteria

- [ ] `pnpm --filter web test` passes including the four new boundary regression tests
- [ ] Four regressions prove: (1) `entries()` throw → queue intact + zero rejections; (2) `delete("mutations")` throw → not-removed mutations remain queued; (3) `put("snapshots")` throw → queue empty, snapshot stale, NOT retryable; (4) cleanup throw → queue empty, pointer stale, NOT retryable
- [ ] `pnpm type-check` passes
- [ ] `pnpm architecture` passes
