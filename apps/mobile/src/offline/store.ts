/**
 * `OfflineStore` — a minimal key/value port over the three logical stores
 * the offline module needs (Phase 5 mobile offline, 09b-v1).
 *
 * Mirrors web's `apps/web/src/app/(app)/plan/offline/store.ts` port shape
 * exactly, so `queue.ts` / `identity.ts` / `snapshot.ts` are unit-testable
 * against a plain in-memory fake (`__test-utils__/in-memory-store.ts`) with
 * ZERO AsyncStorage mocking — only `async-storage-db.ts` itself needs to
 * mock `@react-native-async-storage/async-storage`.
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
   * as a SINGLE indivisible operation (design: "Atomic `clientSeq`
   * allocation"). Unlike a separate `get` + `put` pair, this closes the
   * race where two overlapping callers on the SAME identity (e.g. a rapid
   * double-tap dispatching two `handleRecordSet` calls before the first's
   * `await` resolves) both read the same high-water-mark before either
   * writes, silently clobbering each other's mutation at the same
   * `clientSeq` key.
   */
  incrementCounter(storeName: OfflineStoreName, key: string): Promise<number>;
}
