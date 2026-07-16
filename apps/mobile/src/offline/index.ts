/**
 * Barrel for the mobile offline module (Phase 5 mobile offline — 09b-v1).
 * Consumed by `WorkoutTrackerScreen.tsx`.
 */
export type { OfflineStore, OfflineStoreName } from "./store";
export { openOfflineDb } from "./async-storage-db";
export {
  nextClientSeq,
  enqueueMutation,
  getQueuedMutations,
  removeMutation,
} from "./queue";
export {
  writeSnapshot,
  readSnapshot,
  clearSnapshot,
  applyOptimisticComplete,
  writeActiveSessionPointer,
  readActiveSessionPointer,
  clearActiveSessionPointer,
} from "./snapshot";
export { ensureIdentityScope, clearIdentityScope, resolveIdentityKey } from "./identity";
export { createConnectivityMonitor } from "./connectivity";
export { applyPendingMutation } from "./apply-mutation";
export {
  classifyFlushError,
  runSequentialFlush,
  type SendMutationOutcome,
  type FlushSummary,
} from "./flush";
