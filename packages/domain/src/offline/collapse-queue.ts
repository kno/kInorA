import type { PendingMutation } from "@kinora/contracts";

/**
 * Collapses a raw FIFO `PendingMutation` queue into the set that should
 * actually be flushed:
 *
 * - For `"set"` mutations, only the latest entry per `setId` survives —
 *   "latest" is decided by `clientSeq` (the monotonic, collision-free
 *   client-assigned counter), never `queuedAt` (wall-clock, can tie under
 *   rapid taps).
 * - Any `"complete"` mutation is always ordered last, so the sequential
 *   flush loop applies every set mutation before completing the session.
 * - The surviving `"set"` mutations are ordered ascending by `clientSeq`.
 *
 * Pure — no I/O, no mutation of the input array.
 */
export function collapseQueue(mutations: PendingMutation[]): PendingMutation[] {
  const latestBySetId = new Map<string, PendingMutation & { kind: "set" }>();
  let latestComplete: (PendingMutation & { kind: "complete" }) | undefined;

  for (const mutation of mutations) {
    if (mutation.kind === "set") {
      const existing = latestBySetId.get(mutation.setId);
      if (!existing || mutation.clientSeq > existing.clientSeq) {
        latestBySetId.set(mutation.setId, mutation);
      }
      continue;
    }

    if (!latestComplete || mutation.clientSeq > latestComplete.clientSeq) {
      latestComplete = mutation;
    }
  }

  const collapsedSets = [...latestBySetId.values()].sort(
    (a, b) => a.clientSeq - b.clientSeq,
  );

  return latestComplete ? [...collapsedSets, latestComplete] : collapsedSets;
}
