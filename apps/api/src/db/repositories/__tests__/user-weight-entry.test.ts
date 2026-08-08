import { describe, it, expect, vi } from "vitest";
import { UserWeightEntryRepository } from "../user-weight-entry.js";

const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";

function entryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    userId: USER_A,
    weightKg: "72.50",
    recordedAt: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function selectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where, orderBy, limit };
}

function insertChain(returnRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnRows);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, returning };
}

function countChain(count: number) {
  const where = vi.fn().mockResolvedValue([{ count }]);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where };
}

/**
 * Build a fake `Database`-shaped object whose `.transaction(cb)` invokes the
 * callback with a `tx` supporting `.execute` (advisory lock), `.insert`
 * (the new row) and `.select` (the post-insert count).
 */
function buildTxDb(opts: { insertedRow: unknown; count: number }) {
  const execute = vi.fn().mockResolvedValue(undefined);
  const { insert, values, returning } = insertChain([opts.insertedRow]);
  const { select, from, where } = countChain(opts.count);

  const tx = { execute, insert, select };
  const transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
  return { db: { transaction } as never, execute, insert, values, returning, select, from, where };
}

describe("UserWeightEntryRepository", () => {
  describe("list", () => {
    it("returns entries newest-first, capped at 100", async () => {
      const rows = [entryRow(), entryRow({ id: "entry-2" })];
      const { select, where, orderBy, limit } = selectChain(rows);
      const repo = new UserWeightEntryRepository({ select } as never);

      const result = await repo.list(USER_A);

      expect(select).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
      expect(orderBy).toHaveBeenCalledTimes(1);
      expect(limit).toHaveBeenCalledWith(100);
      expect(result).toEqual([
        { id: "entry-1", weightKg: 72.5, recordedAt: "2026-08-01T00:00:00.000Z" },
        { id: "entry-2", weightKg: 72.5, recordedAt: "2026-08-01T00:00:00.000Z" },
      ]);
    });

    it("user isolation: list for user B queries by B's id, not A's", async () => {
      const { select, where } = selectChain([]);
      const repo = new UserWeightEntryRepository({ select } as never);

      await repo.list(USER_B);

      expect(where).toHaveBeenCalledTimes(1);
    });
  });

  describe("insert", () => {
    it("acquires the per-user advisory lock before insert + count", async () => {
      const row = entryRow();
      const { db, execute, insert } = buildTxDb({ insertedRow: row, count: 1 });
      const repo = new UserWeightEntryRepository(db);

      await repo.insert(USER_A, { weightKg: 72.5 });

      expect(execute).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledTimes(1);
    });

    it("reports wasFirstEntry: true when the post-insert count is exactly 1", async () => {
      const row = entryRow();
      const { db } = buildTxDb({ insertedRow: row, count: 1 });
      const repo = new UserWeightEntryRepository(db);

      const result = await repo.insert(USER_A, { weightKg: 72.5 });

      expect(result.wasFirstEntry).toBe(true);
      expect(result.entry).toEqual({
        id: "entry-1",
        weightKg: 72.5,
        recordedAt: "2026-08-01T00:00:00.000Z",
      });
    });

    it("reports wasFirstEntry: false when the post-insert count is greater than 1", async () => {
      const row = entryRow({ id: "entry-2" });
      const { db } = buildTxDb({ insertedRow: row, count: 2 });
      const repo = new UserWeightEntryRepository(db);

      const result = await repo.insert(USER_A, { weightKg: 80 });

      expect(result.wasFirstEntry).toBe(false);
    });

    it("passes an explicit recordedAt through to the insert values", async () => {
      const row = entryRow();
      const { db, values } = buildTxDb({ insertedRow: row, count: 1 });
      const repo = new UserWeightEntryRepository(db);

      await repo.insert(USER_A, { weightKg: 72.5, recordedAt: "2026-01-01T00:00:00.000Z" });

      const payload = values.mock.calls[0][0];
      expect(payload).toMatchObject({ userId: USER_A, weightKg: "72.5" });
      expect(payload.recordedAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    });

    it("omits recordedAt (defaults to now()) when not supplied", async () => {
      const row = entryRow();
      const { db, values } = buildTxDb({ insertedRow: row, count: 1 });
      const repo = new UserWeightEntryRepository(db);

      await repo.insert(USER_A, { weightKg: 72.5 });

      const payload = values.mock.calls[0][0];
      expect(payload.recordedAt).toBeUndefined();
    });
  });

  describe("listAllForUser", () => {
    it("returns the full series ascending by recordedAt, unbounded", async () => {
      const rows = [entryRow(), entryRow({ id: "entry-2" })];
      const where = vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(rows),
      });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });
      const repo = new UserWeightEntryRepository({ select } as never);

      const result = await repo.listAllForUser(USER_A);

      expect(result).toEqual([
        { weightKg: 72.5, recordedAt: "2026-08-01T00:00:00.000Z" },
        { weightKg: 72.5, recordedAt: "2026-08-01T00:00:00.000Z" },
      ]);
    });
  });
});
