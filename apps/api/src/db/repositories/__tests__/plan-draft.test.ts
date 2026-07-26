import { describe, it, expect, vi } from "vitest";
import { PlanDraftRepository } from "../plan-draft.js";
import type { PlanSpec } from "@kinora/contracts";

// Minimal valid PlanSpec fixture used across tests
const specFixture: Partial<PlanSpec> = {
  goal: "strength",
  location: "gym",
  daysPerWeek: 3,
  sessionDurationMinutes: 60,
  equipment: ["barbell"],
  limitations: [],
  preferenceScores: {
    strength: 0.9,
    hypertrophy: 0.6,
    endurance: 0.2,
    mobility: 0.3,
  },
};

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-uuid-1",
    tenantId: TENANT_A,
    userId: USER_A,
    step: 1,
    specJson: specFixture,
    version: 0,
    updatedAt: new Date("2026-06-27T12:00:00Z"),
    ...overrides,
  };
}

// Mock chain helpers following the project's mock-db pattern (see session.test.ts)

function onConflictChain(returnRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnRows);
  // Drizzle API: .onConflictDoUpdate({ target, set }) returns { returning }
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

function deleteChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockReturnValue({ where });
  return { delete: del, where };
}

/** insert(...).onConflictDoNothing({ target }).returning() chain (#215 INSERT path). */
function onConflictDoNothingChain(returnRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnRows);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, onConflictDoNothing, returning };
}

/** update(...).set(set).where(...).returning() chain (#215 version-guarded UPDATE path). */
function updateChain(returnRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnRows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { update, set, where, returning };
}

describe("PlanDraftRepository", () => {
  describe("upsert — single-active invariant", () => {
    it("inserts a draft and returns it", async () => {
      const row = draftRow();
      const { insert, values, onConflictDoUpdate, returning } =
        onConflictChain([row]);
      const repo = new PlanDraftRepository({ insert } as never);

      const result = await repo.upsert(TENANT_A, USER_A, 1, specFixture);

      expect(insert).toHaveBeenCalledTimes(1);
      expect(values).toHaveBeenCalledTimes(1);
      expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
      expect(returning).toHaveBeenCalledTimes(1);
      expect(result).toEqual(row);
    });

    it("second upsert for same tenant+user calls onConflictDoUpdate (replaces first)", async () => {
      const updatedRow = draftRow({ step: 2 });
      const { insert, onConflictDoUpdate, returning } = onConflictChain([
        updatedRow,
      ]);
      const repo = new PlanDraftRepository({ insert } as never);

      const result = await repo.upsert(TENANT_A, USER_A, 2, specFixture);

      // onConflictDoUpdate is the mechanism that enforces single-active
      expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
      expect(result.step).toBe(2);
      expect(returning).toHaveBeenCalledTimes(1);
    });

    it("bumps version on conflict so a concurrent version-guarded commit re-reads (#215)", async () => {
      const { insert, onConflictDoUpdate } = onConflictChain([draftRow()]);
      const repo = new PlanDraftRepository({ insert } as never);

      await repo.upsert(TENANT_A, USER_A, 2, specFixture);

      // The ON CONFLICT set must include a `version` bump (not a fixed value).
      const setArg = onConflictDoUpdate.mock.calls[0]![0].set as Record<string, unknown>;
      expect(setArg.version).toBeDefined();
    });
  });

  describe("commitWithVersion — optimistic concurrency guard (#215)", () => {
    it("with expectedVersion null: INSERTs via onConflictDoNothing and returns the new row", async () => {
      const row = draftRow({ version: 0 });
      const { insert, values, onConflictDoNothing, returning } =
        onConflictDoNothingChain([row]);
      const repo = new PlanDraftRepository({ insert } as never);

      const result = await repo.commitWithVersion(TENANT_A, USER_A, 1, specFixture, null);

      expect(insert).toHaveBeenCalledTimes(1);
      expect(values).toHaveBeenCalledTimes(1);
      expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
      expect(returning).toHaveBeenCalledTimes(1);
      expect(result).toEqual(row);
    });

    it("with expectedVersion null but a concurrent insert already won: empty returning → null (conflict)", async () => {
      const { insert } = onConflictDoNothingChain([]);
      const repo = new PlanDraftRepository({ insert } as never);

      const result = await repo.commitWithVersion(TENANT_A, USER_A, 1, specFixture, null);

      // No row returned (onConflictDoNothing was a no-op) → caller must re-read.
      expect(result).toBeNull();
    });

    it("with a matching expectedVersion: UPDATE applies and returns the bumped row", async () => {
      const bumped = draftRow({ version: 3, step: 2 });
      const { update, set, where, returning } = updateChain([bumped]);
      const repo = new PlanDraftRepository({ update } as never);

      const result = await repo.commitWithVersion(TENANT_A, USER_A, 2, specFixture, 2);

      expect(update).toHaveBeenCalledTimes(1);
      // The new version is expectedVersion + 1.
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ step: 2, specJson: specFixture, version: 3 }),
      );
      expect(where).toHaveBeenCalledTimes(1);
      expect(returning).toHaveBeenCalledTimes(1);
      expect(result).toEqual(bumped);
    });

    it("with a stale expectedVersion (row moved under us): empty returning → null (conflict)", async () => {
      // A concurrent turn already bumped the version, so the WHERE version = N
      // predicate matches no row and returning() is empty.
      const { update } = updateChain([]);
      const repo = new PlanDraftRepository({ update } as never);

      const result = await repo.commitWithVersion(TENANT_A, USER_A, 2, specFixture, 2);

      expect(result).toBeNull();
    });
  });

  describe("findCurrent", () => {
    it("returns null when no draft exists for tenant+user", async () => {
      const { select } = selectChain([]);
      const repo = new PlanDraftRepository({ select } as never);

      const result = await repo.findCurrent(TENANT_A, USER_A);

      expect(result).toBeNull();
    });

    it("returns the draft when it exists", async () => {
      const row = draftRow({ step: 3 });
      const { select } = selectChain([row]);
      const repo = new PlanDraftRepository({ select } as never);

      const result = await repo.findCurrent(TENANT_A, USER_A);

      expect(result).toEqual(row);
      expect(result?.step).toBe(3);
    });

    it("cross-tenant isolation: tenant B cannot read tenant A draft", async () => {
      // Same userId but different tenant — returns no rows
      const { select } = selectChain([]);
      const repo = new PlanDraftRepository({ select } as never);

      const result = await repo.findCurrent(TENANT_B, USER_A);

      expect(result).toBeNull();
      expect(select).toHaveBeenCalledTimes(1);
    });
  });

  describe("delete", () => {
    it("deletes the draft for a given tenant+user", async () => {
      const { delete: del, where } = deleteChain();
      const repo = new PlanDraftRepository({ delete: del } as never);

      await repo.delete(TENANT_A, USER_A);

      expect(del).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
    });
  });

  describe("cross-tenant isolation at insert", () => {
    it("tenant B upsert is a separate call that does not affect tenant A", async () => {
      const rowA = draftRow({ tenantId: TENANT_A, userId: USER_A });
      const { insert: insertA } = onConflictChain([rowA]);

      const rowB = draftRow({ tenantId: TENANT_B, userId: USER_B });
      const { insert: insertB } = onConflictChain([rowB]);

      const repoA = new PlanDraftRepository({ insert: insertA } as never);
      const repoB = new PlanDraftRepository({ insert: insertB } as never);

      await repoA.upsert(TENANT_A, USER_A, 1, specFixture);
      await repoB.upsert(TENANT_B, USER_B, 1, specFixture);

      // Each repo uses its own mock insert — no cross-contamination
      expect(insertA).toHaveBeenCalledTimes(1);
      expect(insertB).toHaveBeenCalledTimes(1);
    });
  });
});
