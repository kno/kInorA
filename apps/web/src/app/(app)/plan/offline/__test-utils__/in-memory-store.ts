import type { OfflineStore, OfflineStoreName } from "../store";

/**
 * In-memory fake implementing the same `OfflineStore` port the real
 * idb-backed adapter (`db.ts`) implements. Used across offline module unit
 * tests so pure queue/snapshot/identity logic never needs to mock idb
 * directly (Mock Hygiene Rule — extract the logic, test it without mocks).
 */
export function createInMemoryOfflineStore(): OfflineStore {
  const stores: Record<OfflineStoreName, Map<string, unknown>> = {
    mutations: new Map(),
    snapshots: new Map(),
    meta: new Map(),
  };

  return {
    async get<T>(storeName: OfflineStoreName, key: string): Promise<T | undefined> {
      return stores[storeName].get(key) as T | undefined;
    },
    async put<T>(storeName: OfflineStoreName, key: string, value: T): Promise<void> {
      stores[storeName].set(key, value);
    },
    async delete(storeName: OfflineStoreName, key: string): Promise<void> {
      stores[storeName].delete(key);
    },
    async entries<T>(storeName: OfflineStoreName): Promise<Array<{ key: string; value: T }>> {
      return Array.from(stores[storeName].entries()).map(([key, value]) => ({
        key,
        value: value as T,
      }));
    },
    async clear(storeName: OfflineStoreName): Promise<void> {
      stores[storeName].clear();
    },
    // Deliberately has NO `await` before the write — the whole read-modify-
    // write runs synchronously to completion within one JS task/microtask,
    // so no concurrently-called `incrementCounter` can observe a stale
    // pre-write value (mirrors the single-IndexedDB-transaction guarantee
    // the real `db.ts` adapter provides).
    async incrementCounter(storeName: OfflineStoreName, key: string): Promise<number> {
      const current = (stores[storeName].get(key) as number | undefined) ?? 0;
      const next = current + 1;
      stores[storeName].set(key, next);
      return next;
    },
  };
}
