import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * `db.ts` — the real idb-backed `OfflineStore` adapter (Phase 4 web
 * offline). This is the ONLY offline-module test file that mocks `idb`
 * directly (Mock Hygiene: 1 mock, single responsibility — verifying the
 * adapter wires `get`/`put`/`delete`/`entries`/`clear` onto idb's
 * transaction API). All queue/snapshot/identity LOGIC is tested against the
 * in-memory fake store instead (see queue.test.ts / snapshot.test.ts /
 * identity.test.ts).
 */

const fakeTxStore = {
  get: vi.fn(),
  put: vi.fn(),
};
const fakeTx = {
  store: fakeTxStore,
  done: Promise.resolve(),
};

const fakeDb = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  getAllKeys: vi.fn(),
  getAll: vi.fn(),
  clear: vi.fn(),
  transaction: vi.fn(() => fakeTx),
};

const openDB = vi.fn(async (..._args: unknown[]) => fakeDb);

vi.mock("idb", () => ({
  openDB: (...args: unknown[]) => openDB(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("openOfflineDb (idb adapter)", () => {
  it("put() writes through idb's put on the given store name", async () => {
    const { openOfflineDb } = await import("../db");
    const store = await openOfflineDb();

    await store.put("meta", "some-key", 42);

    expect(fakeDb.put).toHaveBeenCalledWith("meta", 42, "some-key");
  });

  it("get() reads through idb's get and returns the stored value", async () => {
    fakeDb.get.mockResolvedValueOnce("stored-value");
    const { openOfflineDb } = await import("../db");
    const store = await openOfflineDb();

    const result = await store.get("meta", "some-key");

    expect(fakeDb.get).toHaveBeenCalledWith("meta", "some-key");
    expect(result).toBe("stored-value");
  });

  it("entries() pairs idb's keys with their values", async () => {
    fakeDb.getAllKeys.mockResolvedValueOnce(["k1", "k2"]);
    fakeDb.getAll.mockResolvedValueOnce(["v1", "v2"]);
    const { openOfflineDb } = await import("../db");
    const store = await openOfflineDb();

    const result = await store.entries("mutations");

    expect(result).toEqual([
      { key: "k1", value: "v1" },
      { key: "k2", value: "v2" },
    ]);
  });
});

describe("openOfflineDb — incrementCounter (atomic clientSeq allocation)", () => {
  it("reads-then-writes within a SINGLE readwrite transaction, never db.get()/db.put()", async () => {
    fakeTxStore.get.mockResolvedValueOnce(4);
    const { openOfflineDb } = await import("../db");
    const store = await openOfflineDb();

    const next = await store.incrementCounter("meta", "some-key");

    expect(next).toBe(5);
    expect(fakeDb.transaction).toHaveBeenCalledWith("meta", "readwrite");
    expect(fakeTxStore.get).toHaveBeenCalledWith("some-key");
    expect(fakeTxStore.put).toHaveBeenCalledWith(5, "some-key");
    // The single-transaction convenience methods must NOT be used here —
    // using them would open two SEPARATE transactions, reopening the race.
    expect(fakeDb.get).not.toHaveBeenCalled();
    expect(fakeDb.put).not.toHaveBeenCalled();
  });

  it("defaults the counter to 0 → 1 when no prior value exists", async () => {
    fakeTxStore.get.mockResolvedValueOnce(undefined);
    const { openOfflineDb } = await import("../db");
    const store = await openOfflineDb();

    const next = await store.incrementCounter("meta", "fresh-key");

    expect(next).toBe(1);
  });
});
