import type { OfflineStore, OfflineStoreName } from "../store";

/**
 * In-memory fake `OfflineStore`, used by ALL pure-logic offline tests so no
 * AsyncStorage mocking is needed (Mock Hygiene Rule — mirrors web's
 * `__test-utils__/in-memory-store.ts`). Only `async-storage-db.test.ts`
 * mocks the real native module.
 *
 * `incrementCounter` has NO `await` between its read and its write, so the
 * synchronous run-to-completion semantics of a single JS task make
 * interleaving impossible here — the same guarantee the real adapter must
 * provide via its own mutex (AsyncStorage has no native transactions).
 */
export function createInMemoryStore(): OfflineStore {
  const data: Record<OfflineStoreName, Map<string, unknown>> = {
    mutations: new Map(),
    snapshots: new Map(),
    meta: new Map(),
  };

  return {
    async get<T>(storeName: OfflineStoreName, key: string): Promise<T | undefined> {
      return data[storeName].get(key) as T | undefined;
    },
    async put<T>(storeName: OfflineStoreName, key: string, value: T): Promise<void> {
      data[storeName].set(key, value);
    },
    async delete(storeName: OfflineStoreName, key: string): Promise<void> {
      data[storeName].delete(key);
    },
    async entries<T>(
      storeName: OfflineStoreName,
    ): Promise<Array<{ key: string; value: T }>> {
      return [...data[storeName].entries()].map(([key, value]) => ({
        key,
        value: value as T,
      }));
    },
    async clear(storeName: OfflineStoreName): Promise<void> {
      data[storeName].clear();
    },
    async incrementCounter(storeName: OfflineStoreName, key: string): Promise<number> {
      const current = (data[storeName].get(key) as number | undefined) ?? 0;
      const next = current + 1;
      data[storeName].set(key, next);
      return next;
    },
  };
}
