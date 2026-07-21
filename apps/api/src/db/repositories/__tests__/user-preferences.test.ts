import { describe, it, expect, vi } from "vitest";
import { UserPreferencesRepository } from "../user-preferences.js";

const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";

function preferencesRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER_A,
    defaultLocation: "gym",
    defaultDuration: 60,
    defaultEquipment: ["dumbbells", "bench"],
    createdAt: new Date("2026-07-21T10:00:00Z"),
    updatedAt: new Date("2026-07-21T10:00:00Z"),
    ...overrides,
  };
}

// Mock chain helpers following the project's existing mock-db pattern
// (see plan-draft.test.ts, user-profile.test.ts).

function onConflictChain(returnRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnRows);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, onConflictDoUpdate, returning };
}

function selectChain(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where };
}

describe("UserPreferencesRepository", () => {
  describe("findByUserId", () => {
    it("returns the preferences row when it exists", async () => {
      const row = preferencesRow();
      const { select } = selectChain([row]);
      const repo = new UserPreferencesRepository({ select } as never);

      const result = await repo.findByUserId(USER_A);

      expect(select).toHaveBeenCalledTimes(1);
      expect(result).toEqual(row);
      expect(result?.userId).toBe(USER_A);
      expect(result?.defaultLocation).toBe("gym");
      expect(result?.defaultDuration).toBe(60);
      expect(result?.defaultEquipment).toEqual(["dumbbells", "bench"]);
    });

    it("returns null when no preferences row exists for the user", async () => {
      const { select } = selectChain([]);
      const repo = new UserPreferencesRepository({ select } as never);

      const result = await repo.findByUserId("nobody");

      expect(result).toBeNull();
    });

    it("user isolation: findByUserId for user B returns B's row", async () => {
      const rowB = preferencesRow({
        userId: USER_B,
        defaultLocation: "home",
        defaultDuration: 30,
        defaultEquipment: [],
      });
      const { select } = selectChain([rowB]);
      const repo = new UserPreferencesRepository({ select } as never);

      const result = await repo.findByUserId(USER_B);

      expect(result).toEqual(rowB);
      expect(result?.userId).toBe(USER_B);
      expect(result?.userId).not.toBe(USER_A);
    });
  });

  describe("upsert", () => {
    it("creates a preferences row on first upsert", async () => {
      const row = preferencesRow();
      const { insert, values, onConflictDoUpdate, returning } = onConflictChain([
        row,
      ]);
      const repo = new UserPreferencesRepository({ insert } as never);

      const result = await repo.upsert(USER_A, {
        defaultLocation: "gym",
        defaultDuration: 60,
        defaultEquipment: ["dumbbells", "bench"],
      });

      expect(insert).toHaveBeenCalledTimes(1);
      expect(values).toHaveBeenCalledTimes(1);
      expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
      expect(returning).toHaveBeenCalledTimes(1);
      expect(result).toEqual(row);
      const payload = values.mock.calls[0][0];
      expect(payload).toMatchObject({
        userId: USER_A,
        defaultLocation: "gym",
        defaultDuration: 60,
        defaultEquipment: ["dumbbells", "bench"],
      });
    });

    it("partial merge: sending only defaultDuration leaves other SET fields out of the SET clause", async () => {
      const updated = preferencesRow({ defaultDuration: 30 });
      const { insert, onConflictDoUpdate } = onConflictChain([updated]);
      const repo = new UserPreferencesRepository({ insert } as never);

      await repo.upsert(USER_A, { defaultDuration: 30 });

      // onConflictDoUpdate MUST be called, but the SET object MUST only
      // include the sent field + updatedAt. Unsent fields are NOT in SET,
      // therefore preserved (partial merge is carried by the absence of the
      // keys from the SET clause, not by copying existing values back in).
      const { set } = onConflictDoUpdate.mock.calls[0][0] as {
        target: unknown;
        set: Record<string, unknown>;
      };
      expect(set.defaultDuration).toBe(30);
      expect(set).not.toHaveProperty("defaultLocation");
      expect(set).not.toHaveProperty("defaultEquipment");
      expect(set.updatedAt).toBeInstanceOf(Date);
    });

    it("overwrites only sent fields: explicit null sets the column to NULL", async () => {
      const { insert, onConflictDoUpdate } = onConflictChain([
        preferencesRow({ defaultLocation: null }),
      ]);
      const repo = new UserPreferencesRepository({ insert } as never);

      await repo.upsert(USER_A, { defaultLocation: null });

      const { set } = onConflictDoUpdate.mock.calls[0][0] as {
        set: Record<string, unknown>;
      };
      // Sent field IS present in SET even when null — distinct from "not sent".
      expect(set).toHaveProperty("defaultLocation", null);
    });

    it("empty equipment array is sent as [] (distinct from NULL)", async () => {
      const { insert, values } = onConflictChain([
        preferencesRow({ defaultEquipment: [] }),
      ]);
      const repo = new UserPreferencesRepository({ insert } as never);

      await repo.upsert(USER_A, { defaultEquipment: [] });

      const payload = values.mock.calls[0][0];
      expect(payload.defaultEquipment).toEqual([]);
      expect(payload.defaultEquipment).not.toBeNull();
    });

    // TRIANGULATION (duration): non-positive duration is a silent data
    // invariant violation — the unique-index row would still be writable
    // but the value is meaningless. The repo MUST refuse it regardless of
    // the route layer's own 422 check (defense in depth). Postgres schemas
    // cannot express "positive integer" declaratively, so this lives here.
    it("rejects non-positive defaultDuration at repo level (invariant guard)", async () => {
      const { insert } = onConflictChain([]);
      const repo = new UserPreferencesRepository({ insert } as never);

      await expect(
        repo.upsert(USER_A, { defaultDuration: 0 })
      ).rejects.toThrow(/defaultDuration/i);
      await expect(
        repo.upsert(USER_A, { defaultDuration: -10 })
      ).rejects.toThrow(/defaultDuration/i);
      // Insert path never reached: guard throws before calling the DB layer.
      expect(insert).not.toHaveBeenCalled();
    });

    it("null defaultDuration is accepted (explicit 'unset')", async () => {
      const { insert, onConflictDoUpdate } = onConflictChain([
        preferencesRow({ defaultDuration: null }),
      ]);
      const repo = new UserPreferencesRepository({ insert } as never);

      await repo.upsert(USER_A, { defaultDuration: null });

      const { set } = onConflictDoUpdate.mock.calls[0][0] as {
        set: Record<string, unknown>;
      };
      expect(set).toHaveProperty("defaultDuration", null);
    });

    it("upsert with empty partial and a different userId is isolated at write", async () => {
      const rowA = preferencesRow({ userId: USER_A });
      const { insert: insertA } = onConflictChain([rowA]);
      const rowB = preferencesRow({ userId: USER_B, defaultLocation: "home" });
      const { insert: insertB } = onConflictChain([rowB]);

      const repoA = new UserPreferencesRepository({ insert: insertA } as never);
      const repoB = new UserPreferencesRepository({ insert: insertB } as never);

      await repoA.upsert(USER_A, { defaultLocation: "gym" });
      await repoB.upsert(USER_B, { defaultLocation: "home" });

      expect(insertA).toHaveBeenCalledTimes(1);
      expect(insertB).toHaveBeenCalledTimes(1);
    });
  });
});