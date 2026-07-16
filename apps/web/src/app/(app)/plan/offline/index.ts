/**
 * Barrel for the web offline module (Phase 4 web offline — 09b-v1).
 * Consumed by `use-workout-session.ts`.
 */
export type { OfflineStore, OfflineStoreName } from "./store";
export { openOfflineDb } from "./db";
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
export { ensureIdentityScope, clearIdentityScope } from "./identity";
export { createConnectivityMonitor } from "./connectivity";
export { applyPendingMutation } from "./apply-mutation";
export {
  classifyFlushError,
  isStaleActionError,
  runSequentialFlush,
  type SendMutationOutcome,
  type FlushSummary,
} from "./flush";
