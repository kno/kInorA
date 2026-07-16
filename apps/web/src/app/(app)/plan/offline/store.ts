/**
 * `OfflineStore` — a minimal key/value port over the three object stores the
 * offline module needs (Phase 4 web offline).
 *
 * Splitting this port out from the real idb-backed adapter (`db.ts`) lets
 * `queue.ts` / `identity.ts` / `snapshot.ts` be unit-tested against a plain
 * in-memory fake (`__test-utils__/in-memory-store.ts`) with ZERO idb/browser
 * mocking — only `db.ts` itself needs to mock `idb`'s `openDB`.
 */
export type OfflineStoreName = "mutations" | "snapshots" | "meta";

export interface OfflineStore {
  get<T>(storeName: OfflineStoreName, key: string): Promise<T | undefined>;
  put<T>(storeName: OfflineStoreName, key: string, value: T): Promise<void>;
  delete(storeName: OfflineStoreName, key: string): Promise<void>;
  entries<T>(storeName: OfflineStoreName): Promise<Array<{ key: string; value: T }>>;
  clear(storeName: OfflineStoreName): Promise<void>;
  /**
   * Atomically reads the numeric counter at `key` (defaulting to 0 when
   * absent), increments it by 1, persists the new value, and returns it —
   * as a SINGLE indivisible operation (Phase 4 web offline: `nextClientSeq`
   * atomicity fix). Unlike a separate `get` + `put` pair (two independent
   * transactions), this closes the race where two concurrent callers on the
   * SAME identity both read the same high-water-mark before either writes,
   * silently clobbering each other's mutation at the same `clientSeq` key.
   */
  incrementCounter(storeName: OfflineStoreName, key: string): Promise<number>;
}
