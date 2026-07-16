import AsyncStorage from "@react-native-async-storage/async-storage";
import type { OfflineStore, OfflineStoreName } from "./store";

/**
 * Real AsyncStorage-backed `OfflineStore` adapter (Phase 5 mobile offline).
 *
 * `@react-native-async-storage/async-storage` (design decision: "Storage
 * libs — idb (web) + AsyncStorage (mobile)") is a flat async key/value
 * store — there is no concept of separate "object stores" like idb, so
 * each logical `OfflineStoreName` is namespaced as a key PREFIX
 * (`kinora-offline:${storeName}:${key}`) within the single AsyncStorage
 * keyspace.
 *
 * Atomicity gap vs. idb: IndexedDB gives web a native `readwrite`
 * transaction that serializes overlapping calls against the same object
 * store for free (see web's `db.ts`). AsyncStorage has NO transactions at
 * all — a `getItem` followed by a `setItem` is two independent operations
 * that can interleave with another overlapping `getItem`/`setItem` pair.
 * Since this is still a single JS process (no multi-tab equivalent on
 * mobile — the realistic race here is two overlapping async call sites,
 * e.g. a rapid double-tap dispatching two `enqueueMutation` calls before
 * the first's `await` resolves), `incrementCounter` is instead made atomic
 * via an IN-PROCESS async mutex: a per-key promise chain that serializes
 * every `incrementCounter` call for that key onto a single queue, so the
 * read-modify-write for a given key can never observe an interleaved write
 * from a concurrent call to the SAME key. Calls for DIFFERENT keys are not
 * serialized against each other (no reason to block unrelated identities).
 */

const KEY_PREFIX = "kinora-offline";

function storageKey(storeName: OfflineStoreName, key: string): string {
  return `${KEY_PREFIX}:${storeName}:${key}`;
}

function parseValue<T>(raw: string | null): T | undefined {
  if (raw === null) return undefined;
  return JSON.parse(raw) as T;
}

// Per-key mutex: chains every incrementCounter call for the SAME storage
// key onto the previous call's completion, so no two callers ever read the
// same counter value before either writes.
const counterMutexes = new Map<string, Promise<unknown>>();

function runExclusive<T>(mutexKey: string, task: () => Promise<T>): Promise<T> {
  const previous = counterMutexes.get(mutexKey) ?? Promise.resolve();
  const next = previous.then(task, task);
  // Swallow rejections in the chain itself (the caller still sees the
  // real rejection via `next`) so one failed increment never poisons the
  // mutex for subsequent calls on the same key.
  counterMutexes.set(
    mutexKey,
    next.catch(() => undefined),
  );
  return next;
}

export async function openOfflineDb(): Promise<OfflineStore> {
  return {
    async get<T>(storeName: OfflineStoreName, key: string): Promise<T | undefined> {
      const raw = await AsyncStorage.getItem(storageKey(storeName, key));
      return parseValue<T>(raw);
    },

    async put<T>(storeName: OfflineStoreName, key: string, value: T): Promise<void> {
      await AsyncStorage.setItem(storageKey(storeName, key), JSON.stringify(value));
    },

    async delete(storeName: OfflineStoreName, key: string): Promise<void> {
      await AsyncStorage.removeItem(storageKey(storeName, key));
    },

    async entries<T>(
      storeName: OfflineStoreName,
    ): Promise<Array<{ key: string; value: T }>> {
      const allKeys = await AsyncStorage.getAllKeys();
      const prefix = `${KEY_PREFIX}:${storeName}:`;
      const scopedKeys = allKeys.filter((k) => k.startsWith(prefix));
      if (scopedKeys.length === 0) return [];

      const pairs = await AsyncStorage.multiGet(scopedKeys);
      return pairs
        .filter(([, raw]) => raw !== null)
        .map(([fullKey, raw]) => ({
          key: fullKey.slice(prefix.length),
          value: JSON.parse(raw as string) as T,
        }));
    },

    async clear(storeName: OfflineStoreName): Promise<void> {
      const allKeys = await AsyncStorage.getAllKeys();
      const prefix = `${KEY_PREFIX}:${storeName}:`;
      const scopedKeys = allKeys.filter((k) => k.startsWith(prefix));
      if (scopedKeys.length > 0) {
        await AsyncStorage.multiRemove(scopedKeys);
      }
    },

    async incrementCounter(storeName: OfflineStoreName, key: string): Promise<number> {
      const fullKey = storageKey(storeName, key);
      return runExclusive(fullKey, async () => {
        const raw = await AsyncStorage.getItem(fullKey);
        const current = raw === null ? 0 : (JSON.parse(raw) as number);
        const next = current + 1;
        await AsyncStorage.setItem(fullKey, JSON.stringify(next));
        return next;
      });
    },
  };
}
