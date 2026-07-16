import type { PendingMutation } from "@kinora/contracts";
import type { OfflineStore } from "./store";

/**
 * `PendingMutation` queue, persisted via the injected `OfflineStore`
 * (Phase 4 web offline — design "Queue is FIFO with last-write-wins
 * collapse").
 *
 * `clientSeq` is the monotonic, collision-free ordering + LWW tie-break key.
 * It is persisted as a `lastClientSeq` high-water-mark under the identity's
 * `meta` namespace so it survives an app restart and never resets to 0 —
 * mutations queued before a restart keep correct relative order against
 * mutations queued after.
 *
 * Every key (mutation, snapshot, meta) is namespaced by `identityKey`
 * (`${tenantId}:${userId}`, see `identity.ts`) so a shared-device login
 * switch never mixes queues between accounts.
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K & keyof T>
  : never;

function lastClientSeqKey(identityKey: string): string {
  return `${identityKey}:lastClientSeq`;
}

function mutationKey(identityKey: string, clientSeq: number): string {
  return `${identityKey}:${clientSeq}`;
}

/**
 * Advances and persists the identity-scoped `clientSeq` high-water-mark.
 * Never resets to 0 on load — reads the last persisted value, or starts at 0
 * only the very first time this identity is ever seen.
 *
 * Allocation is ATOMIC via `store.incrementCounter` — a single indivisible
 * read-modify-write. A separate `get` then `put` (two independent
 * transactions) would let two concurrent callers on the SAME identity (e.g.
 * two tabs) both read the same high-water-mark before either writes,
 * silently clobbering each other's mutation at the same
 * `${identityKey}:${clientSeq}` key.
 */
export async function nextClientSeq(
  store: OfflineStore,
  identityKey: string,
): Promise<number> {
  return store.incrementCounter("meta", lastClientSeqKey(identityKey));
}

export async function enqueueMutation(
  store: OfflineStore,
  identityKey: string,
  mutation: DistributiveOmit<PendingMutation, "clientSeq">,
): Promise<PendingMutation> {
  const clientSeq = await nextClientSeq(store, identityKey);
  const key = mutationKey(identityKey, clientSeq);

  // Defense-in-depth: nextClientSeq is atomic and should never allocate a
  // clientSeq that already has a mutation persisted under it — but if it
  // ever did (e.g. a future regression re-introduces a non-atomic path),
  // fail loudly instead of silently overwriting (and losing) the existing
  // mutation at this key.
  const existing = await store.get("mutations", key);
  if (existing !== undefined) {
    throw new Error(
      `offline queue: refusing to overwrite an existing mutation at ${key}`,
    );
  }

  const full = { ...mutation, clientSeq } as PendingMutation;
  await store.put("mutations", key, full);
  return full;
}

export async function getQueuedMutations(
  store: OfflineStore,
  identityKey: string,
): Promise<PendingMutation[]> {
  const all = await store.entries<PendingMutation>("mutations");
  const prefix = `${identityKey}:`;
  return all
    .filter(({ key }) => key.startsWith(prefix))
    .map(({ value }) => value);
}

export async function removeMutation(
  store: OfflineStore,
  identityKey: string,
  clientSeq: number,
): Promise<void> {
  await store.delete("mutations", mutationKey(identityKey, clientSeq));
}
