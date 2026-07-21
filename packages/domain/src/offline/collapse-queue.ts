import type { PendingMutation } from "@kinora/contracts";

/**
 * Collapses a raw FIFO `PendingMutation` queue into the set that should
 * actually be flushed:
 *
 * - For `"set"` mutations, only the latest entry per `setId` survives —
 *   "latest" is decided by `clientSeq` (the monotonic, collision-free
 *   client-assigned counter), never `queuedAt` (wall-clock, can tie under
 *   rapid taps).
 * - For `"complete"` mutations, only the latest entry per `sessionId` survives.
 *   All surviving completes are ordered after sets, by `clientSeq`.
 * - The surviving `"set"` mutations are ordered ascending by `clientSeq`.
 *
 * Pure — no I/O, no mutation of the input array.
 */
export function collapseQueue(mutations: PendingMutation[]): PendingMutation[] {
  const latestBySetId = new Map<string, PendingMutation & { kind: "set" }>();
  const latestCompleteBySessionId = new Map<
    string,
    PendingMutation & { kind: "complete" }
  >();

  for (const mutation of mutations) {
    if (mutation.kind === "set") {
      const existing = latestBySetId.get(mutation.setId);
      if (!existing || mutation.clientSeq > existing.clientSeq) {
        latestBySetId.set(mutation.setId, mutation);
      }
      continue;
    }

    const existing = latestCompleteBySessionId.get(mutation.sessionId);
    if (!existing || mutation.clientSeq > existing.clientSeq) {
      latestCompleteBySessionId.set(mutation.sessionId, mutation);
    }
  }

  const collapsedSets = [...latestBySetId.values()].sort(
    (a, b) => a.clientSeq - b.clientSeq || a.setId.localeCompare(b.setId),
  );
  const collapsedCompletes = [...latestCompleteBySessionId.values()].sort(
    (a, b) => a.clientSeq - b.clientSeq || a.sessionId.localeCompare(b.sessionId),
  );

  return [...collapsedSets, ...collapsedCompletes];
}
