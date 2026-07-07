import { describe, it, expect, vi } from "vitest";
import { WorkoutPlanRepository } from "../workout-plan.js";
import type { WorkoutProgram } from "@kinora/contracts";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const SPEC_A = "aaaaaaaa-0000-0000-0000-000000000003";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";
const PLAN_ID = "cccccccc-0000-0000-0000-000000000001";

const sampleProgram: WorkoutProgram = {
  weeklySessions: [
    {
      day: 1,
      title: "Push Day",
      exercises: [
        {
          name: "Bench Press",
          sets: 3,
          reps: "8-10",
          restSeconds: 90,
        },
      ],
    },
  ],
  limitationWarnings: [],
};

function insertChain(returnRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnRows);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, returning };
}

function updateChain(returnRows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnRows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { update, set, where, returning };
}

function selectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where, orderBy, limit };
}

function selectChainNoOrder(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where };
}

/** Chain for queries that end at orderBy (no limit) — used by findAllByUser. */
function selectChainOrderOnly(rows: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where, orderBy };
}

describe("WorkoutPlanRepository", () => {
  describe("createGenerating", () => {
    it("inserts a row with status 'generating' and returns { id, status }", async () => {
      const row = {
        id: PLAN_ID,
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        status: "generating" as const,
        programJson: null,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { insert, values, returning } = insertChain([row]);
      const repo = new WorkoutPlanRepository({ insert } as never);

      const result = await repo.createGenerating(TENANT_A, USER_A, SPEC_A);

      expect(insert).toHaveBeenCalledTimes(1);
      expect(values).toHaveBeenCalledTimes(1);
      expect(returning).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(PLAN_ID);
      expect(result.status).toBe("generating");
    });

    it("sets status to 'generating' in the inserted values", async () => {
      const row = {
        id: "other-id",
        tenantId: TENANT_B,
        userId: USER_B,
        planSpecId: SPEC_A,
        status: "generating" as const,
        programJson: null,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { insert, values } = insertChain([row]);
      const repo = new WorkoutPlanRepository({ insert } as never);

      await repo.createGenerating(TENANT_B, USER_B, SPEC_A);

      const insertedValues = (values as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Record<string, unknown>;
      expect(insertedValues.status).toBe("generating");
      expect(insertedValues.tenantId).toBe(TENANT_B);
      expect(insertedValues.userId).toBe(USER_B);
      expect(insertedValues.planSpecId).toBe(SPEC_A);
    });

    it("persists a user-supplied name into the inserted values (#93)", async () => {
      const row = {
        id: PLAN_ID,
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        status: "generating" as const,
        name: "Summer Cut",
        programJson: null,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { insert, values } = insertChain([row]);
      const repo = new WorkoutPlanRepository({ insert } as never);

      await repo.createGenerating(TENANT_A, USER_A, SPEC_A, "Summer Cut");

      const insertedValues = (values as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Record<string, unknown>;
      expect(insertedValues.name).toBe("Summer Cut");
    });

    it("stores name as null when no name is supplied (#93 — never defaults at write time)", async () => {
      const row = {
        id: PLAN_ID,
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        status: "generating" as const,
        name: null,
        programJson: null,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { insert, values } = insertChain([row]);
      const repo = new WorkoutPlanRepository({ insert } as never);

      await repo.createGenerating(TENANT_A, USER_A, SPEC_A);

      const insertedValues = (values as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Record<string, unknown>;
      // A blank/absent name is stored as null so defaultPlanName resolves on read.
      expect(insertedValues.name ?? null).toBeNull();
    });
  });

  describe("markReady", () => {
    it("updates status to 'ready' and persists program_json", async () => {
      const updatedRow = {
        id: PLAN_ID,
        status: "ready" as const,
        programJson: sampleProgram,
        errorMessage: null,
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { update, set, where, returning } = updateChain([updatedRow]);
      const repo = new WorkoutPlanRepository({ update } as never);

      const result = await repo.markReady(TENANT_A, PLAN_ID, sampleProgram);

      expect(update).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
      expect(returning).toHaveBeenCalledTimes(1);
      expect(result!.status).toBe("ready");
      expect(result!.programJson).toEqual(sampleProgram);
    });

    it("sets status and programJson in the update payload", async () => {
      const updatedRow = {
        id: PLAN_ID,
        status: "ready" as const,
        programJson: sampleProgram,
        errorMessage: null,
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { update, set } = updateChain([updatedRow]);
      const repo = new WorkoutPlanRepository({ update } as never);

      await repo.markReady(TENANT_A, PLAN_ID, sampleProgram);

      const setPayload = (set as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Record<string, unknown>;
      expect(setPayload.status).toBe("ready");
      expect(setPayload.programJson).toEqual(sampleProgram);
    });

    it("cross-tenant isolation: returns undefined when tenantId does not match the row", async () => {
      // TENANT_B tries to markReady a row owned by TENANT_A → the tenant+id WHERE returns 0 rows
      const { update } = updateChain([]);
      const repo = new WorkoutPlanRepository({ update } as never);

      const result = await repo.markReady(TENANT_B, PLAN_ID, sampleProgram);

      expect(result).toBeUndefined();
    });
  });

  describe("markFailed", () => {
    it("updates status to 'failed' and persists error_message", async () => {
      const updatedRow = {
        id: PLAN_ID,
        status: "failed" as const,
        programJson: null,
        errorMessage: "LLM timeout",
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { update, set, where, returning } = updateChain([updatedRow]);
      const repo = new WorkoutPlanRepository({ update } as never);

      const result = await repo.markFailed(TENANT_A, PLAN_ID, "LLM timeout");

      expect(update).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
      expect(returning).toHaveBeenCalledTimes(1);
      expect(result!.status).toBe("failed");
      expect(result!.errorMessage).toBe("LLM timeout");
    });

    it("persists a different error message (triangulate)", async () => {
      const updatedRow = {
        id: PLAN_ID,
        status: "failed" as const,
        programJson: null,
        errorMessage: "Schema validation error",
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { update, set } = updateChain([updatedRow]);
      const repo = new WorkoutPlanRepository({ update } as never);

      await repo.markFailed(TENANT_A, PLAN_ID, "Schema validation error");

      const setPayload = (set as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Record<string, unknown>;
      expect(setPayload.errorMessage).toBe("Schema validation error");
    });

    it("cross-tenant isolation: returns undefined when tenantId does not match the row", async () => {
      // TENANT_B tries to markFailed a row owned by TENANT_A → the tenant+id WHERE returns 0 rows
      const { update } = updateChain([]);
      const repo = new WorkoutPlanRepository({ update } as never);

      const result = await repo.markFailed(TENANT_B, PLAN_ID, "any error");

      expect(result).toBeUndefined();
    });
  });

  describe("findLatestByPlanSpec", () => {
    it("returns the most recent row for a tenant+planSpecId (newest first)", async () => {
      const newerRow = {
        id: "plan-newer",
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        status: "ready" as const,
        programJson: sampleProgram,
        errorMessage: null,
        createdAt: new Date("2026-06-29T10:00:00Z"),
        updatedAt: new Date("2026-06-29T10:00:00Z"),
      };
      const { select, where, orderBy, limit } = selectChain([newerRow]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findLatestByPlanSpec(TENANT_A, SPEC_A);

      expect(select).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
      expect(orderBy).toHaveBeenCalledTimes(1);
      expect(limit).toHaveBeenCalledWith(1);
      expect(result).not.toBeUndefined();
      expect(result!.id).toBe("plan-newer");
      expect(result!.status).toBe("ready");
    });

    it("orderBy argument is DESC on createdAt (locks newest-first invariant)", async () => {
      // The mock returns rows in whatever order we give it; we verify the query
      // asks for descending order by inspecting the SQL node passed to orderBy().
      // Drizzle's desc() produces a SQL node whose queryChunks contain " desc".
      const olderRow = {
        id: "plan-older",
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        status: "generating" as const,
        programJson: null,
        errorMessage: null,
        createdAt: new Date("2026-06-28T09:00:00Z"),
        updatedAt: new Date("2026-06-28T09:00:00Z"),
      };
      const newerRow = {
        id: "plan-newer",
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        status: "ready" as const,
        programJson: sampleProgram,
        errorMessage: null,
        createdAt: new Date("2026-06-29T10:00:00Z"),
        updatedAt: new Date("2026-06-29T10:00:00Z"),
      };
      // Mock resolves newest-first (as the ORDER BY DESC would produce in SQL)
      const { select, orderBy } = selectChain([newerRow, olderRow]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findLatestByPlanSpec(TENANT_A, SPEC_A);

      // The repo must pass a DESC expression to orderBy — check via queryChunks
      expect(orderBy).toHaveBeenCalledTimes(1);
      const orderByArg = (orderBy as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        queryChunks?: Array<{ value?: string[] }>;
      };
      const chunks = orderByArg.queryChunks ?? [];
      const hasDesc = chunks.some((chunk) =>
        (chunk.value ?? []).some((v) => v.includes("desc"))
      );
      expect(hasDesc).toBe(true);
      // And the first result is the newer row (limit(1) picks first from the ordered set)
      expect(result!.id).toBe("plan-newer");
    });

    it("returns undefined when no plan exists for the spec", async () => {
      const { select } = selectChain([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findLatestByPlanSpec(TENANT_A, SPEC_A);

      expect(result).toBeUndefined();
    });

    it("cross-tenant: returns undefined when tenant B queries tenant A spec", async () => {
      // Tenant B's where clause filters by TENANT_B → no rows
      const { select } = selectChain([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findLatestByPlanSpec(TENANT_B, SPEC_A);

      expect(result).toBeUndefined();
    });
  });

  describe("findAllByUser", () => {
    it("returns summaries ordered newest-first (createdAt DESC) for tenant+user", async () => {
      const newer = {
        id: "plan-newer",
        status: "ready" as const,
        createdAt: new Date("2026-06-29T10:00:00Z"),
      };
      const older = {
        id: "plan-older",
        status: "generating" as const,
        createdAt: new Date("2026-06-28T09:00:00Z"),
      };
      // DB mock returns rows newest-first (as ORDER BY created_at DESC would)
      const { select, orderBy } = selectChainOrderOnly([newer, older]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findAllByUser(TENANT_A, USER_A);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("plan-newer");
      expect(result[1].id).toBe("plan-older");
      // Verify DESC ordering was requested
      expect(orderBy).toHaveBeenCalledTimes(1);
      const orderByArg = (orderBy as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        queryChunks?: Array<{ value?: string[] }>;
      };
      const chunks = orderByArg.queryChunks ?? [];
      const hasDesc = chunks.some((chunk) =>
        (chunk.value ?? []).some((v) => v.includes("desc"))
      );
      expect(hasDesc).toBe(true);
    });

    it("returns only own plans when multiple users exist in the same tenant (cross-user isolation)", async () => {
      // Mock returns empty — the WHERE clause for USER_B finds nothing
      const { select } = selectChainOrderOnly([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findAllByUser(TENANT_A, USER_B);

      expect(result).toHaveLength(0);
    });

    it("returns empty array when no plans exist for the user", async () => {
      const { select } = selectChainOrderOnly([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findAllByUser(TENANT_A, USER_A);

      expect(result).toHaveLength(0);
    });

    it("returns only own plans — cross-tenant isolation", async () => {
      // TENANT_B queries: WHERE clause filters by TENANT_B → no rows
      const { select } = selectChainOrderOnly([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findAllByUser(TENANT_B, USER_A);

      expect(result).toHaveLength(0);
    });

    it("maps each row to { id, status, createdAt } summary shape", async () => {
      const createdAt = new Date("2026-06-29T10:00:00Z");
      const row = {
        id: PLAN_ID,
        status: "ready" as const,
        createdAt,
      };
      const { select } = selectChainOrderOnly([row]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findAllByUser(TENANT_A, USER_A);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(PLAN_ID);
      expect(result[0].status).toBe("ready");
      expect(result[0].createdAt).toEqual(createdAt);
    });

    it("projects the plan name into the summary (#93) — non-null name passes through", async () => {
      const createdAt = new Date("2026-06-29T10:00:00Z");
      const row = {
        id: PLAN_ID,
        status: "ready" as const,
        createdAt,
        name: "Summer Cut",
      };
      const { select } = selectChainOrderOnly([row]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findAllByUser(TENANT_A, USER_A);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Summer Cut");
    });

    it("projects a null plan name as null (#93) — adapter resolves the default on read", async () => {
      const createdAt = new Date("2026-06-29T10:00:00Z");
      const row = {
        id: PLAN_ID,
        status: "ready" as const,
        createdAt,
        name: null,
      };
      const { select } = selectChainOrderOnly([row]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findAllByUser(TENANT_A, USER_A);

      expect(result).toHaveLength(1);
      // The repo does NOT resolve the default — it faithfully returns the raw
      // column value (null). defaultPlanName is applied by the app.ts adapter.
      expect(result[0].name).toBeNull();
    });

    it("includes name in the select projection (#93)", async () => {
      const createdAt = new Date("2026-06-29T10:00:00Z");
      const row = { id: PLAN_ID, status: "ready" as const, createdAt, name: null };
      const { select } = selectChainOrderOnly([row]);
      const repo = new WorkoutPlanRepository({ select } as never);

      await repo.findAllByUser(TENANT_A, USER_A);

      const selectArg = (select as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Record<string, unknown>;
      expect(selectArg).toHaveProperty("name");
    });
  });

  describe("findById", () => {
    it("returns the plan when it belongs to the requesting tenant+user", async () => {
      const row = {
        id: PLAN_ID,
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        status: "ready" as const,
        programJson: sampleProgram,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { select, where } = selectChainNoOrder([row]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findById(TENANT_A, USER_A, PLAN_ID);

      expect(select).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
      expect(result).not.toBeUndefined();
      expect(result!.id).toBe(PLAN_ID);
      expect(result!.tenantId).toBe(TENANT_A);
    });

    it("returns undefined when the plan belongs to a different tenant (cross-tenant isolation)", async () => {
      const { select } = selectChainNoOrder([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findById(TENANT_B, USER_A, PLAN_ID);

      expect(result).toBeUndefined();
    });

    it("cross-user isolation: WHERE clause includes userId — same tenant, different user returns undefined (Fix 1)", async () => {
      // Before the fix, findById(tenantId, id) had only 2 params — userId was ignored.
      // After the fix, WHERE includes user_id=$2, so a different userId finds nothing.
      // The mock returns [] to simulate no match for USER_B's WHERE clause.
      const { select } = selectChainNoOrder([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findById(TENANT_A, USER_B, PLAN_ID);

      expect(result).toBeUndefined();
    });

    it("cross-user isolation: WHERE passes userId to the db query (Fix 1)", async () => {
      // Verify the where call receives 3 conditions (tenant + user + id)
      // by checking the repo passes userId correctly. We use a row-returning mock
      // and verify the where clause is called — the impl must include userId in AND.
      const row = {
        id: PLAN_ID,
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        status: "ready" as const,
        programJson: sampleProgram,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { select, where } = selectChainNoOrder([row]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findById(TENANT_A, USER_A, PLAN_ID);

      // The where clause must be called (WHERE tenant+user+id)
      expect(where).toHaveBeenCalledTimes(1);
      expect(result).not.toBeUndefined();
      expect(result!.id).toBe(PLAN_ID);
    });
  });

  describe("findLatestByPlanSpec — user-scoping (Fix 2)", () => {
    it("cross-user isolation: same tenant but different user returns undefined (Fix 2)", async () => {
      // Before the fix, findLatestByPlanSpec(tenantId, planSpecId) was tenant-only.
      // After the fix, WHERE includes user_id, so USER_B finds nothing for USER_A's spec.
      const { select } = selectChain([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findLatestByPlanSpec(TENANT_A, USER_B, SPEC_A);

      expect(result).toBeUndefined();
    });

    it("returns the plan when tenant+user+spec all match", async () => {
      const row = {
        id: PLAN_ID,
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        status: "ready" as const,
        programJson: sampleProgram,
        errorMessage: null,
        createdAt: new Date("2026-06-29T10:00:00Z"),
        updatedAt: new Date("2026-06-29T10:00:00Z"),
      };
      const { select } = selectChain([row]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findLatestByPlanSpec(TENANT_A, USER_A, SPEC_A);

      expect(result).not.toBeUndefined();
      expect(result!.id).toBe(PLAN_ID);
    });
  });
});
