import type { WorkoutSessionRecord, WorkoutSessionSnapshot } from "@kinora/contracts";
import type { OfflineStore } from "./store";

/**
 * `WorkoutSessionSnapshot` cache — the read-side complement to the
 * `PendingMutation` queue (Phase 4 web offline design: "Local store persists
 * a session snapshot, not only the mutation queue"). Lets the tracker
 * hydrate its UI on an offline reload without a network GET.
 *
 * Namespaced by `identityKey` (see `identity.ts`) — the SAME scoping the
 * queue uses.
 */

function snapshotKey(identityKey: string, sessionId: string): string {
  return `${identityKey}:${sessionId}`;
}

export async function writeSnapshot(
  store: OfflineStore,
  identityKey: string,
  sessionId: string,
  session: WorkoutSessionRecord,
): Promise<void> {
  const snapshot: WorkoutSessionSnapshot = {
    sessionId,
    session,
    cachedAt: Date.now(),
  };
  await store.put("snapshots", snapshotKey(identityKey, sessionId), snapshot);
}

export async function readSnapshot(
  store: OfflineStore,
  identityKey: string,
  sessionId: string,
): Promise<WorkoutSessionSnapshot | undefined> {
  return store.get<WorkoutSessionSnapshot>(
    "snapshots",
    snapshotKey(identityKey, sessionId),
  );
}

/**
 * Eviction policy (design): cleared once the session is both completed AND
 * fully synced (queue empty for that sessionId), and unconditionally on
 * logout (see `identity.ts` `clearIdentityScope`).
 */
export async function clearSnapshot(
  store: OfflineStore,
  identityKey: string,
  sessionId: string,
): Promise<void> {
  await store.delete("snapshots", snapshotKey(identityKey, sessionId));
}

/**
 * Complete-mutation optimistic semantics (design): enqueuing a `complete`
 * mutation flips the cached snapshot's `session.status` to `"completed"` at
 * the same time — so an offline reload after tapping Complete (before
 * reconnect/ack) renders as completed. Pure — never mutates the input.
 */
function activePointerKey(identityKey: string): string {
  return `${identityKey}:activeSessionId`;
}

/**
 * "Active session pointer" — tracks WHICH cached snapshot offline hydration
 * should read on mount. The tracker only learns a `sessionId` after a
 * session is started/resumed, and there is exactly one active session per
 * identity at a time (the existing 409 `active_session_conflict` rule), so a
 * single per-identity pointer is sufficient.
 */
export async function writeActiveSessionPointer(
  store: OfflineStore,
  identityKey: string,
  sessionId: string,
): Promise<void> {
  await store.put("meta", activePointerKey(identityKey), sessionId);
}

export async function readActiveSessionPointer(
  store: OfflineStore,
  identityKey: string,
): Promise<string | undefined> {
  return store.get<string>("meta", activePointerKey(identityKey));
}

export async function clearActiveSessionPointer(
  store: OfflineStore,
  identityKey: string,
): Promise<void> {
  await store.delete("meta", activePointerKey(identityKey));
}

/**
 * Forget a session that has reached a terminal status: drop its cached
 * snapshot and, when the active-session pointer still names it, drop the
 * pointer too.
 *
 * The pointer is only cleared when it names THIS session (or is already
 * absent) so a newer session's pointer is never collateral damage.
 *
 * This is the single write-side cleanup for every terminal route — flush
 * acknowledgement, an online complete, an abandon — so no route can leave a
 * pointer naming a finished session behind.
 */
export async function discardTerminalSession(
  store: OfflineStore,
  identityKey: string,
  sessionId: string,
): Promise<void> {
  await clearSnapshot(store, identityKey, sessionId);
  const pointer = await readActiveSessionPointer(store, identityKey);
  if (pointer === undefined || pointer === sessionId) {
    await clearActiveSessionPointer(store, identityKey);
  }
}

export function applyOptimisticComplete(
  snapshot: WorkoutSessionSnapshot,
): WorkoutSessionSnapshot {
  return {
    ...snapshot,
    session: { ...snapshot.session, status: "completed" },
    cachedAt: Date.now(),
  };
}
