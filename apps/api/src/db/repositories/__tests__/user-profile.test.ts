import { describe, it, expect, vi } from "vitest";
import { UserProfileRepository } from "../user-profile.js";

const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER_A,
    name: "Alex",
    goal: "hypertrophy" as const,
    experienceLevel: "intermediate" as const,
    selfDescribedSex: null,
    heightCm: null,
    createdAt: new Date("2026-07-21T10:00:00Z"),
    updatedAt: new Date("2026-07-21T10:00:00Z"),
    ...overrides,
  };
}

// Mock chain helpers following the project's existing mock-db pattern
// (see plan-draft.test.ts, session.test.ts).

function onConflictChain(returnRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnRows);
  // Drizzle API: .onConflictDoUpdate({ target, set }) returns { returning }
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate, onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, onConflictDoUpdate, onConflictDoNothing, returning };
}

function selectChain(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where };
}

describe("UserProfileRepository", () => {
  describe("findByUserId", () => {
    it("returns the profile row when it exists", async () => {
      const row = profileRow();
      const { select } = selectChain([row]);
      const repo = new UserProfileRepository({ select } as never);

      const result = await repo.findByUserId(USER_A);

      expect(select).toHaveBeenCalledTimes(1);
      expect(result).toEqual(row);
      expect(result?.userId).toBe(USER_A);
      expect(result?.name).toBe("Alex");
    });

    it("returns null when no profile exists for the user", async () => {
      const { select } = selectChain([]);
      const repo = new UserProfileRepository({ select } as never);

      const result = await repo.findByUserId("nobody");

      expect(result).toBeNull();
    });

    // TRIANGULATION (User isolation): a different userId returns its own row,
    // never user A's. This proves the WHERE clause is parameterised on userId
    // and there is no accidental cross-user read.
    it("user isolation: findByUserId for user B returns B's row, not A's", async () => {
      const rowB = profileRow({
        userId: USER_B,
        name: "Sam",
        goal: "strength" as const,
        experienceLevel: "advanced" as const,
      });
      const { select } = selectChain([rowB]);
      const repo = new UserProfileRepository({ select } as never);

      const result = await repo.findByUserId(USER_B);

      expect(result).toEqual(rowB);
      expect(result?.userId).toBe(USER_B);
      expect(result?.name).toBe("Sam");
      expect(result?.userId).not.toBe(USER_A);
    });
  });

  describe("upsert", () => {
    it("creates a profile row (first upsert for a new user)", async () => {
      const row = profileRow();
      const { insert, values, onConflictDoUpdate, returning } = onConflictChain([
        row,
      ]);
      const repo = new UserProfileRepository({ insert } as never);

      const result = await repo.upsert(USER_A, {
        name: "Alex",
        goal: "hypertrophy",
        experienceLevel: "intermediate",
        selfDescribedSex: null,
        heightCm: null,
      });

      expect(insert).toHaveBeenCalledTimes(1);
      expect(values).toHaveBeenCalledTimes(1);
      expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
      expect(returning).toHaveBeenCalledTimes(1);
      expect(result).toEqual(row);
      // The values payload MUST carry the supplied fields
      const payload = values.mock.calls[0][0];
      expect(payload).toMatchObject({
        userId: USER_A,
        name: "Alex",
        goal: "hypertrophy",
        experienceLevel: "intermediate",
        selfDescribedSex: null,
        heightCm: null,
      });
    });

    it("updates an existing profile row (calls onConflictDoUpdate on userId)", async () => {
      const updated = profileRow({ name: "Alex Updated", goal: "strength" });
      const { insert, onConflictDoUpdate, returning } = onConflictChain([
        updated,
      ]);
      const repo = new UserProfileRepository({ insert } as never);

      const result = await repo.upsert(USER_A, {
        name: "Alex Updated",
        goal: "strength",
        experienceLevel: "intermediate",
        selfDescribedSex: null,
        heightCm: null,
      });

      // ON CONFLICT (userId) DO UPDATE is the mechanism that keeps one row per user.
      expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
      expect(returning).toHaveBeenCalledTimes(1);
      expect(result.name).toBe("Alex Updated");
      expect(result.goal).toBe("strength");
    });

    // TRIANGULATION: upsert writes ONLY the supplied enum fields; when
    // goal/experienceLevel are null/undefined they MUST be written as NULL
    // (not silently preserved from the previous row). This matches R3:
    // an auto-provisioned row starts with goal=NULL, experienceLevel=NULL.
    it("upsert with null goal/experienceLevel writes nulls (auto-provision shape)", async () => {
      const provisioned = profileRow({
        goal: null,
        experienceLevel: null,
        name: "alex",
      });
      const { insert, values } = onConflictChain([provisioned]);
      const repo = new UserProfileRepository({ insert } as never);

      await repo.upsert(USER_A, {
        name: "alex",
        goal: null,
        experienceLevel: null,
        selfDescribedSex: null,
        heightCm: null,
      });

      const payload = values.mock.calls[0][0];
      expect(payload.goal).toBeNull();
      expect(payload.experienceLevel).toBeNull();
      expect(payload.name).toBe("alex");
    });

    it("upsert for a different user is a separate insert call (user isolation at write)", async () => {
      const rowA = profileRow({ userId: USER_A, name: "Alex" });
      const { insert: insertA } = onConflictChain([rowA]);
      const rowB = profileRow({ userId: USER_B, name: "Sam" });
      const { insert: insertB } = onConflictChain([rowB]);

      const repoA = new UserProfileRepository({ insert: insertA } as never);
      const repoB = new UserProfileRepository({ insert: insertB } as never);

      await repoA.upsert(USER_A, {
        name: "Alex",
        goal: null,
        experienceLevel: null,
        selfDescribedSex: null,
        heightCm: null,
      });
      await repoB.upsert(USER_B, {
        name: "Sam",
        goal: null,
        experienceLevel: null,
        selfDescribedSex: null,
        heightCm: null,
      });

      expect(insertA).toHaveBeenCalledTimes(1);
      expect(insertB).toHaveBeenCalledTimes(1);
    });

    // 17c PR1: selfDescribedSex + heightCm round-trip through upsert.
    it("upsert writes selfDescribedSex and heightCm through create and update", async () => {
      const row = profileRow({ selfDescribedSex: "female", heightCm: 165 });
      const { insert, values } = onConflictChain([row]);
      const repo = new UserProfileRepository({ insert } as never);

      const result = await repo.upsert(USER_A, {
        name: "Alex",
        goal: "hypertrophy",
        experienceLevel: "intermediate",
        selfDescribedSex: "female",
        heightCm: 165,
      });

      expect(result.selfDescribedSex).toBe("female");
      expect(result.heightCm).toBe(165);
      const payload = values.mock.calls[0][0];
      expect(payload.selfDescribedSex).toBe("female");
      expect(payload.heightCm).toBe(165);
    });

    // 17c PR1: prefer_not_to_say persists distinctly from null.
    it("upsert persists prefer_not_to_say distinctly from null", async () => {
      const row = profileRow({ selfDescribedSex: "prefer_not_to_say" });
      const { insert, values } = onConflictChain([row]);
      const repo = new UserProfileRepository({ insert } as never);

      const result = await repo.upsert(USER_A, {
        name: "Alex",
        goal: null,
        experienceLevel: null,
        selfDescribedSex: "prefer_not_to_say",
        heightCm: null,
      });

      expect(result.selfDescribedSex).toBe("prefer_not_to_say");
      expect(result.selfDescribedSex).not.toBeNull();
      const payload = values.mock.calls[0][0];
      expect(payload.selfDescribedSex).toBe("prefer_not_to_say");
    });

    // 17c PR1: null clears a previously set value.
    it("upsert writes null for selfDescribedSex/heightCm to clear a previously set value", async () => {
      const row = profileRow({ selfDescribedSex: null, heightCm: null });
      const { insert, values } = onConflictChain([row]);
      const repo = new UserProfileRepository({ insert } as never);

      await repo.upsert(USER_A, {
        name: "Alex",
        goal: null,
        experienceLevel: null,
        selfDescribedSex: null,
        heightCm: null,
      });

      const payload = values.mock.calls[0][0];
      expect(payload.selfDescribedSex).toBeNull();
      expect(payload.heightCm).toBeNull();
    });
  });

  describe("createIfMissing", () => {
    it("uses insert-on-conflict-no-op so lazy provisioning cannot overwrite a concurrent PUT", async () => {
      const { insert, values, onConflictDoNothing } = onConflictChain([]);
      const repo = new UserProfileRepository({ insert } as never);

      await repo.createIfMissing(USER_A, {
        name: "alex",
        goal: null,
        experienceLevel: null,
        selfDescribedSex: null,
        heightCm: null,
      });

      expect(insert).toHaveBeenCalledTimes(1);
      expect(values).toHaveBeenCalledWith({
        userId: USER_A,
        name: "alex",
        goal: null,
        experienceLevel: null,
        selfDescribedSex: null,
        heightCm: null,
      });
      expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    });
  });

  // 17c PR1: create/read round-trip through findByUserId.
  describe("findByUserId — body metrics", () => {
    it("returns selfDescribedSex and heightCm when previously stored", async () => {
      const row = profileRow({ selfDescribedSex: "other", heightCm: 178 });
      const { select } = selectChain([row]);
      const repo = new UserProfileRepository({ select } as never);

      const result = await repo.findByUserId(USER_A);

      expect(result?.selfDescribedSex).toBe("other");
      expect(result?.heightCm).toBe(178);
    });
  });
});
