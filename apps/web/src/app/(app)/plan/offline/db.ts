import { openDB, type IDBPDatabase } from "idb";
import type { OfflineStore, OfflineStoreName } from "./store";

/**
 * Real idb-backed `OfflineStore` adapter (Phase 4 web offline).
 *
 * `idb` (already a transitive dependency via `serwist`, pinned as a direct
 * `apps/web` dependency here) is a tiny typed wrapper over the native
 * IndexedDB transaction API — chosen over hand-rolled IndexedDB (design
 * decision: "Storage libs — idb (web) + AsyncStorage (mobile)"). The queue
 * is a bounded set of pre-known `setId`s + one `complete` per session, so a
 * flat key/value store per object store is sufficient; no indexes needed.
 */

const DB_NAME = "kinora-offline";
const DB_VERSION = 1;
const STORE_NAMES: OfflineStoreName[] = ["mutations", "snapshots", "meta"];

let dbPromise: Promise<IDBPDatabase> | undefined;

function getDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
    },
  });
  return dbPromise;
}

export async function openOfflineDb(): Promise<OfflineStore> {
  const db = await getDb();

  return {
    async get<T>(storeName: OfflineStoreName, key: string): Promise<T | undefined> {
      return db.get(storeName, key) as Promise<T | undefined>;
    },
    async put<T>(storeName: OfflineStoreName, key: string, value: T): Promise<void> {
      await db.put(storeName, value, key);
    },
    async delete(storeName: OfflineStoreName, key: string): Promise<void> {
      await db.delete(storeName, key);
    },
    async entries<T>(
      storeName: OfflineStoreName,
    ): Promise<Array<{ key: string; value: T }>> {
      const [keys, values] = await Promise.all([
        db.getAllKeys(storeName) as Promise<string[]>,
        db.getAll(storeName) as Promise<T[]>,
      ]);
      return keys.map((key, index) => ({ key, value: values[index] as T }));
    },
    async clear(storeName: OfflineStoreName): Promise<void> {
      await db.clear(storeName);
    },
    // Atomic read-modify-write within a SINGLE IndexedDB readwrite
    // transaction (Phase 4 web offline — nextClientSeq atomicity fix).
    // Using db.get()+db.put() (the convenience methods above) would open
    // TWO separate transactions, letting a concurrent caller's read land
    // between this call's read and write. IndexedDB serializes readwrite
    // transactions against the same object store, so two overlapping
    // incrementCounter calls (even across tabs sharing the same origin's
    // IndexedDB) are queued and cannot interleave.
    async incrementCounter(storeName: OfflineStoreName, key: string): Promise<number> {
      const tx = db.transaction(storeName, "readwrite");
      const current = ((await tx.store.get(key)) as number | undefined) ?? 0;
      const next = current + 1;
      await tx.store.put(next, key);
      await tx.done;
      return next;
    },
  };
}
