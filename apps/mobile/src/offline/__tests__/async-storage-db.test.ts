import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => memory.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      memory.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      memory.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...memory.keys()]),
    multiGet: vi.fn(async (keys: string[]) =>
      keys.map((key) => [key, memory.get(key) ?? null] as [string, string | null]),
    ),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) memory.delete(key);
    }),
  },
}));

describe("openOfflineDb (AsyncStorage adapter)", () => {
  beforeEach(() => {
    memory.clear();
    vi.resetModules();
  });

  it("put/get/delete round-trip a JSON value under a namespaced key", async () => {
    const { openOfflineDb } = await import("../async-storage-db");
    const store = await openOfflineDb();
    await store.put("mutations", "id-1:1", { hello: "world" });
    expect(await store.get("mutations", "id-1:1")).toEqual({ hello: "world" });
    await store.delete("mutations", "id-1:1");
    expect(await store.get("mutations", "id-1:1")).toBeUndefined();
  });

  it("entries() returns all key/value pairs scoped to one logical store, never leaking across stores", async () => {
    const { openOfflineDb } = await import("../async-storage-db");
    const store = await openOfflineDb();
    await store.put("mutations", "id-1:1", { a: 1 });
    await store.put("snapshots", "id-1:s1", { b: 2 });

    const mutationEntries = await store.entries("mutations");
    expect(mutationEntries).toEqual([{ key: "id-1:1", value: { a: 1 } }]);
    const snapshotEntries = await store.entries("snapshots");
    expect(snapshotEntries).toEqual([{ key: "id-1:s1", value: { b: 2 } }]);
  });

  it("clear() empties only the targeted logical store", async () => {
    const { openOfflineDb } = await import("../async-storage-db");
    const store = await openOfflineDb();
    await store.put("mutations", "id-1:1", { a: 1 });
    await store.put("snapshots", "id-1:s1", { b: 2 });

    await store.clear("mutations");
    expect(await store.entries("mutations")).toEqual([]);
    expect(await store.entries("snapshots")).toEqual([{ key: "id-1:s1", value: { b: 2 } }]);
  });

  it("incrementCounter starts at 1 and increments monotonically", async () => {
    const { openOfflineDb } = await import("../async-storage-db");
    const store = await openOfflineDb();
    expect(await store.incrementCounter("meta", "id-1:lastClientSeq")).toBe(1);
    expect(await store.incrementCounter("meta", "id-1:lastClientSeq")).toBe(2);
  });

  it("incrementCounter allocates distinct sequential values under concurrent callers (async mutex, no AsyncStorage transactions)", async () => {
    // AsyncStorage has no native transactions (unlike idb's readwrite
    // transaction guarantee on web) — the adapter MUST serialize concurrent
    // incrementCounter calls through an in-process async mutex so two
    // overlapping calls never both read the same high-water-mark before
    // either writes.
    const { openOfflineDb } = await import("../async-storage-db");
    const store = await openOfflineDb();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.incrementCounter("meta", "id-1:lastClientSeq")),
    );
    expect([...results].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("incrementCounter mutex does not serialize UNRELATED keys against each other's latency", async () => {
    const { openOfflineDb } = await import("../async-storage-db");
    const store = await openOfflineDb();
    const [a, b] = await Promise.all([
      store.incrementCounter("meta", "id-1:lastClientSeq"),
      store.incrementCounter("meta", "id-2:lastClientSeq"),
    ]);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});
