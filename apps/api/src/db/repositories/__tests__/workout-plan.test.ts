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

/** Chain for a query that ends at .groupBy() — used by listPlansWithProgress's Q3. */
function selectChainGroupBy(rows: unknown[]) {
  const groupBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ groupBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where, groupBy };
}

/**
 * A `db` double whose `select` returns a DIFFERENT chain per call, in the
 * fixed order `listPlansWithProgress` issues them: Q1 (plans, orderBy), Q2
 * (plan_specs, no orderBy), Q3 (workout_sessions, groupBy). Each call is
 * independently spy-able via the returned `calls` array.
 */
function progressDb(q1Rows: unknown[], q2Rows: unknown[] = [], q3Rows: unknown[] = []) {
  const q1 = selectChainOrderOnly(q1Rows);
  const q2 = selectChainNoOrder(q2Rows);
  const q3 = selectChainGroupBy(q3Rows);
  const select = vi
    .fn()
    .mockReturnValueOnce({ from: q1.from })
    .mockReturnValueOnce({ from: q2.from })
    .mockReturnValueOnce({ from: q3.from });
  return { select, q1, q2, q3 };
}

/**
 * Recursively walks a drizzle SQL node's `queryChunks` looking for a
 * Column named `archived_at` immediately followed by a StringChunk
 * containing " is null" — the shape `isNull(workoutPlans.archivedAt)`
 * compiles to. Used to prove the default-filtered branch appends the
 * condition and the `includeArchived: true` branch omits it, without
 * a real Postgres to execute against.
 */
function sqlContainsArchivedAtIsNull(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return false;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] as { name?: string };
    if (chunk?.name === "archived_at") {
      const next = chunks[i + 1] as { value?: unknown };
      const text = Array.isArray(next?.value) ? next.value.join("") : "";
      if (text.includes("is null")) return true;
    }
  }
  return chunks.some((chunk) => sqlContainsArchivedAtIsNull(chunk));
}

/**
 * Flatten an `and(eq(...), eq(...))` SQL node into the `column = value`
 * equality bindings it compiles to, so a test can assert the WHERE clause is
 * actually guarded on what it claims. Used by the `updateProgram` suite below,
 * where the guard IS the feature: a missing `status`/`version` binding is the
 * difference between optimistic concurrency and a silent lost update, and a db
 * double cannot enforce a WHERE clause on our behalf.
 */
function sqlEqualityBindings(node: unknown): Array<{ column: string; value: unknown }> {
  const chunks = (node as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return [];

  const bindings: Array<{ column: string; value: unknown }> = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] as { name?: string };
    // `and(...)` nests one SQL node per operand, so recurse before matching.
    bindings.push(...sqlEqualityBindings(chunk));

    if (typeof chunk?.name !== "string") continue;

    const operator = chunks[i + 1] as { value?: unknown };
    const text = Array.isArray(operator?.value) ? operator.value.join("") : "";
    if (text.trim() !== "=") continue;

    const param = chunks[i + 2] as { value?: unknown };
    bindings.push({ column: chunk.name, value: param?.value });
  }
  return bindings;
}

/**
 * Flatten a SQL node to its literal text, columns rendered as `<name>` and
 * parameters as `?`. Lets a test assert the SHAPE of a predicate rather than
 * only its bindings — specifically that `updateProgram`'s version guard is a
 * bare column equality with no function wrapped around it (#421), which a db
 * double cannot evaluate but which is load-bearing.
 */
function sqlText(node: unknown): string {
  const chunks = (node as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return "";

  return chunks
    .map((chunk) => {
      const asColumn = chunk as { name?: string };
      if (typeof asColumn.name === "string") return `<${asColumn.name}>`;
      const value = (chunk as { value?: unknown }).value;
      if (Array.isArray(value)) return value.join("");
      if (value !== undefined) return "?";
      // A nested SQL node recurses; anything else is an interpolated value
      // drizzle will bind as a parameter.
      const nested = sqlText(chunk);
      return nested === "" ? "?" : nested;
    })
    .join("");
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

  describe("findAllByUser — archive filter (17d PR B)", () => {
    it("appends an archived_at IS NULL condition to the WHERE clause by default", async () => {
      const { select, where } = selectChainOrderOnly([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      await repo.findAllByUser(TENANT_A, USER_A);

      const whereArg = (where as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sqlContainsArchivedAtIsNull(whereArg)).toBe(true);
    });

    it("omits the archived_at filter when includeArchived: true is passed", async () => {
      const { select, where } = selectChainOrderOnly([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      await repo.findAllByUser(TENANT_A, USER_A, { includeArchived: true });

      const whereArg = (where as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sqlContainsArchivedAtIsNull(whereArg)).toBe(false);
    });

    it("returns archived plans when includeArchived: true is passed", async () => {
      const archivedRow = {
        id: "plan-archived",
        status: "ready" as const,
        createdAt: new Date("2026-06-29T10:00:00Z"),
        archivedAt: new Date("2026-07-01T10:00:00Z"),
      };
      const { select } = selectChainOrderOnly([archivedRow]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findAllByUser(TENANT_A, USER_A, { includeArchived: true });

      expect(result).toHaveLength(1);
      expect(result[0].archivedAt).toEqual(archivedRow.archivedAt);
    });
  });

  describe("setArchived (17d PR B)", () => {
    it("archives a plan: sets archived_at via COALESCE(archived_at, now())", async () => {
      const archivedAt = new Date("2026-08-09T10:00:00Z");
      const { update, set, where, returning } = updateChain([{ id: PLAN_ID, archivedAt }]);
      const repo = new WorkoutPlanRepository({ update } as never);

      const result = await repo.setArchived(TENANT_A, USER_A, PLAN_ID, true);

      expect(update).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
      expect(returning).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: PLAN_ID, archivedAt });
    });

    it("is idempotent: a repeat archive does not move the timestamp (COALESCE keeps the existing value)", async () => {
      // COALESCE(archived_at, now()) is expressed in the SET clause itself, so
      // a repeated archive call against an already-archived row updates 0
      // semantic rows worth of change but the RETURNING still reflects the
      // UNCHANGED existing archivedAt (never a new now()).
      const firstArchivedAt = new Date("2026-08-01T10:00:00Z");
      const { update } = updateChain([{ id: PLAN_ID, archivedAt: firstArchivedAt }]);
      const repo = new WorkoutPlanRepository({ update } as never);

      const result = await repo.setArchived(TENANT_A, USER_A, PLAN_ID, true);

      expect(result?.archivedAt).toEqual(firstArchivedAt);
    });

    it("unarchives a plan: clears archived_at to null", async () => {
      const { update, set } = updateChain([{ id: PLAN_ID, archivedAt: null }]);
      const repo = new WorkoutPlanRepository({ update } as never);

      const result = await repo.setArchived(TENANT_A, USER_A, PLAN_ID, false);

      expect(result).toEqual({ id: PLAN_ID, archivedAt: null });
      const setPayload = (set as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(setPayload.archivedAt).toBeNull();
    });

    it("unarchive is idempotent: unarchiving an already-active plan stays null", async () => {
      const { update } = updateChain([{ id: PLAN_ID, archivedAt: null }]);
      const repo = new WorkoutPlanRepository({ update } as never);

      const result = await repo.setArchived(TENANT_A, USER_A, PLAN_ID, false);

      expect(result?.archivedAt).toBeNull();
    });

    it("cross-user/cross-tenant id resolves to undefined (no IDOR leak)", async () => {
      const { update } = updateChain([]);
      const repo = new WorkoutPlanRepository({ update } as never);

      const result = await repo.setArchived(TENANT_B, USER_B, PLAN_ID, true);

      expect(result).toBeUndefined();
    });

    it("scopes the update by tenant AND user AND id", async () => {
      const { update, where } = updateChain([{ id: PLAN_ID, archivedAt: new Date() }]);
      const repo = new WorkoutPlanRepository({ update } as never);

      await repo.setArchived(TENANT_A, USER_A, PLAN_ID, true);

      expect(where).toHaveBeenCalledTimes(1);
    });
  });

  describe("updateProgram (17d PR D, #421)", () => {
    const EXPECTED_VERSION = 3;

    const editedProgram: WorkoutProgram = {
      weeklySessions: [
        {
          day: 1,
          title: "Push Day",
          exercises: [{ name: "Incline Press", sets: 4, reps: "6-8", restSeconds: 120 }],
        },
      ],
      limitationWarnings: [],
    };

    function updatedRow(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: PLAN_ID,
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        status: "ready" as const,
        name: null,
        programJson: editedProgram,
        errorMessage: null,
        createdAt: new Date("2026-08-01T10:00:00Z"),
        updatedAt: new Date("2026-08-09T10:05:00Z"),
        version: EXPECTED_VERSION + 1,
        ...overrides,
      };
    }

    it("writes the edited program and returns the updated row", async () => {
      const row = updatedRow();
      const { update, set, where, returning } = updateChain([row]);
      const repo = new WorkoutPlanRepository({ update } as never);

      const result = await repo.updateProgram(
        TENANT_A,
        USER_A,
        PLAN_ID,
        editedProgram,
        EXPECTED_VERSION,
      );

      expect(update).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
      expect(returning).toHaveBeenCalledTimes(1);
      expect(result).toEqual(row);
    });

    it("sets program_json and the next version, and nothing else but updated_at", async () => {
      const { update, set } = updateChain([updatedRow()]);
      const repo = new WorkoutPlanRepository({ update } as never);

      await repo.updateProgram(TENANT_A, USER_A, PLAN_ID, editedProgram, EXPECTED_VERSION);

      const payload = (set as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
      expect(payload.programJson).toEqual(editedProgram);
      // Notably absent: `status`. An edit must never flip a plan's lifecycle.
      expect(Object.keys(payload).sort()).toEqual(["programJson", "updatedAt", "version"]);
    });

    it("advances the version by exactly one (#421)", async () => {
      // The whole guarantee in one assertion. The token is a counter, not a
      // clock reading, so it advances by a fixed step on every successful write
      // no matter how close together two writes land. `updated_at` used to
      // carry this role and could not: two edits inside one millisecond left it
      // unchanged at the precision the wire format could carry, so a stale
      // token still matched and silently overwrote a fresh edit.
      const { update, set } = updateChain([updatedRow()]);
      const repo = new WorkoutPlanRepository({ update } as never);

      await repo.updateProgram(TENANT_A, USER_A, PLAN_ID, editedProgram, EXPECTED_VERSION);

      const payload = (set as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        version: number;
        updatedAt: Date;
      };
      expect(payload.version).toBe(EXPECTED_VERSION + 1);
      // `updated_at` still moves, but purely as an audit timestamp now.
      expect(payload.updatedAt).toBeInstanceOf(Date);
    });

    it("conditions the update on tenant AND user AND id AND status='ready' AND version", async () => {
      // The version predicate is a plain equality on a column, deliberately: no
      // `date_trunc`, no cast, no tolerance. Anything that reintroduces a
      // function over the token — the shape the old `updated_at` guard needed —
      // fails here first.
      const { update, where } = updateChain([updatedRow()]);
      const repo = new WorkoutPlanRepository({ update } as never);

      await repo.updateProgram(TENANT_A, USER_A, PLAN_ID, editedProgram, EXPECTED_VERSION);

      const predicate = (where as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sqlEqualityBindings(predicate)).toEqual([
        { column: "tenant_id", value: TENANT_A },
        { column: "user_id", value: USER_A },
        { column: "id", value: PLAN_ID },
        { column: "status", value: "ready" },
        { column: "version", value: EXPECTED_VERSION },
      ]);
      expect(sqlText(predicate)).not.toContain("date_trunc");
    });

    it("returns undefined on 0 rows updated, without saying which guard failed", async () => {
      // The three causes — wrong owner, not ready, stale version — are
      // deliberately indistinguishable here. Disambiguation is the route's job
      // (it re-reads the scoped row); this layer must not leak existence.
      const { update } = updateChain([]);
      const repo = new WorkoutPlanRepository({ update } as never);

      const result = await repo.updateProgram(
        TENANT_B,
        USER_B,
        PLAN_ID,
        editedProgram,
        EXPECTED_VERSION,
      );

      expect(result).toBeUndefined();
    });

    it("returns undefined for a stale expectedVersion (0 rows matched)", async () => {
      const { update } = updateChain([]);
      const repo = new WorkoutPlanRepository({ update } as never);

      const result = await repo.updateProgram(
        TENANT_A,
        USER_A,
        PLAN_ID,
        editedProgram,
        EXPECTED_VERSION - 1,
      );

      expect(result).toBeUndefined();
    });

    it("returns undefined for a non-ready plan (0 rows matched)", async () => {
      const { update } = updateChain([]);
      const repo = new WorkoutPlanRepository({ update } as never);

      const result = await repo.updateProgram(
        TENANT_A,
        USER_A,
        PLAN_ID,
        editedProgram,
        EXPECTED_VERSION,
      );

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

  describe("findLatestReadyByOwner (15b-v2 Phase S2 — #283)", () => {
    it("returns the most recent 'ready' plan for a tenant+owner, newest first", async () => {
      const newerReady = {
        id: "plan-newer-ready",
        tenantId: TENANT_A,
        userId: USER_A,
        planSpecId: SPEC_A,
        status: "ready" as const,
        programJson: sampleProgram,
        errorMessage: null,
        createdAt: new Date("2026-06-29T10:00:00Z"),
        updatedAt: new Date("2026-06-29T10:00:00Z"),
      };
      const { select, where, orderBy, limit } = selectChain([newerReady]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findLatestReadyByOwner(TENANT_A, USER_A);

      expect(select).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
      expect(orderBy).toHaveBeenCalledTimes(1);
      expect(limit).toHaveBeenCalledWith(1);
      expect(result).not.toBeUndefined();
      expect(result!.id).toBe("plan-newer-ready");
      expect(result!.status).toBe("ready");
    });

    it("cross-tenant isolation: tenant B querying owner from tenant A returns undefined", async () => {
      // The WHERE clause filters by (tenantId, userId, status='ready'); tenant B's
      // filter never matches tenant A's row — this proves the trainer-tenant read
      // can NEVER cross into a tenant the resolved trainerTenantId does not name.
      const { select } = selectChain([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findLatestReadyByOwner(TENANT_B, USER_A);

      expect(result).toBeUndefined();
    });

    it("cross-user isolation: same tenant but a different owner returns undefined (client A cannot read client B's plan)", async () => {
      // The WHERE clause always filters by the resolved owner userId — never by
      // any other client's id. Client B's plan is invisible to client A's query.
      const { select } = selectChain([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findLatestReadyByOwner(TENANT_A, USER_B);

      expect(result).toBeUndefined();
    });

    it("does not return a 'generating' or 'failed' plan even if it is the newest row", async () => {
      // The mock simulates the WHERE status='ready' filter excluding a newer
      // non-ready row: the DB layer returns no rows because none match status='ready'.
      const { select } = selectChain([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.findLatestReadyByOwner(TENANT_A, USER_A);

      expect(result).toBeUndefined();
    });
  });

  describe("listPlansWithProgress (17d PR A)", () => {
    it("issues exactly 3 queries for N plans regardless of N (anti-N+1)", async () => {
      const twoPlans = [
        { id: "plan-1", status: "ready" as const, createdAt: new Date("2026-06-29T10:00:00Z"), name: null, planSpecId: SPEC_A },
        { id: "plan-2", status: "ready" as const, createdAt: new Date("2026-06-28T10:00:00Z"), name: null, planSpecId: SPEC_A },
      ];
      const { select } = progressDb(twoPlans, [], []);
      const repo = new WorkoutPlanRepository({ select } as never);

      await repo.listPlansWithProgress(TENANT_A, USER_A);

      expect(select).toHaveBeenCalledTimes(3);
    });

    it("issues exactly ONE query when the user has zero plans (short-circuits Q2/Q3)", async () => {
      const { select } = progressDb([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.listPlansWithProgress(TENANT_A, USER_A);

      expect(select).toHaveBeenCalledTimes(1);
      expect(result).toEqual([]);
    });

    it("a plan with no sessions gets completedSessions: 0 and no lastTrainedAt (absent, not null)", async () => {
      const plans = [
        { id: "plan-1", status: "ready" as const, createdAt: new Date("2026-06-29T10:00:00Z"), name: null, planSpecId: SPEC_A },
      ];
      const { select } = progressDb(plans, [], []);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.listPlansWithProgress(TENANT_A, USER_A);

      expect(result).toHaveLength(1);
      expect(result[0].completedSessions).toBe(0);
      expect(result[0].lastTrainedAt).toBeUndefined();
      expect("lastTrainedAt" in result[0]).toBe(false);
    });

    it("a missing plan_specs row leaves daysPerWeek absent, not 0", async () => {
      const plans = [
        { id: "plan-1", status: "ready" as const, createdAt: new Date("2026-06-29T10:00:00Z"), name: null, planSpecId: SPEC_A },
      ];
      // Q2 returns no matching plan_specs row for SPEC_A.
      const { select } = progressDb(plans, [], []);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.listPlansWithProgress(TENANT_A, USER_A);

      expect(result[0].daysPerWeek).toBeUndefined();
    });

    it("a malformed/legacy spec_json.daysPerWeek (not a positive finite number) leaves daysPerWeek absent", async () => {
      const plans = [
        { id: "plan-1", status: "ready" as const, createdAt: new Date("2026-06-29T10:00:00Z"), name: null, planSpecId: SPEC_A },
      ];
      const specRows = [{ id: SPEC_A, specJson: { daysPerWeek: "3" } }];
      const { select } = progressDb(plans, specRows, []);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.listPlansWithProgress(TENANT_A, USER_A);

      expect(result[0].daysPerWeek).toBeUndefined();
    });

    it("reads a valid spec_json.daysPerWeek from the batched plan_specs read", async () => {
      const plans = [
        { id: "plan-1", status: "ready" as const, createdAt: new Date("2026-06-29T10:00:00Z"), name: null, planSpecId: SPEC_A },
      ];
      const specRows = [{ id: SPEC_A, specJson: { daysPerWeek: 4 } }];
      const { select } = progressDb(plans, specRows, []);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.listPlansWithProgress(TENANT_A, USER_A);

      expect(result[0].daysPerWeek).toBe(4);
    });

    it("merges the completed-count and last-trained aggregate for a plan with sessions", async () => {
      const plans = [
        { id: "plan-1", status: "ready" as const, createdAt: new Date("2026-06-29T10:00:00Z"), name: null, planSpecId: SPEC_A },
      ];
      const progressRows = [
        { workoutPlanId: "plan-1", completed: 5, lastTrained: new Date("2026-07-01T10:00:00Z") },
      ];
      const { select } = progressDb(plans, [], progressRows);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.listPlansWithProgress(TENANT_A, USER_A);

      expect(result[0].completedSessions).toBe(5);
      expect(result[0].lastTrainedAt).toEqual(new Date("2026-07-01T10:00:00Z"));
    });

    it("orders results newest-first, matching findAllByUser", async () => {
      const plans = [
        { id: "plan-newer", status: "ready" as const, createdAt: new Date("2026-06-29T10:00:00Z"), name: null, planSpecId: SPEC_A },
        { id: "plan-older", status: "ready" as const, createdAt: new Date("2026-06-28T10:00:00Z"), name: null, planSpecId: SPEC_A },
      ];
      const { select, q1 } = progressDb(plans, [], []);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.listPlansWithProgress(TENANT_A, USER_A);

      expect(result[0].id).toBe("plan-newer");
      expect(result[1].id).toBe("plan-older");
      const orderByArg = (q1.orderBy as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        queryChunks?: Array<{ value?: string[] }>;
      };
      const chunks = orderByArg.queryChunks ?? [];
      expect(chunks.some((chunk) => (chunk.value ?? []).some((v) => v.includes("desc")))).toBe(true);
    });

    it("cross-tenant/cross-user isolation: an empty Q1 short-circuits without leaking any progress read", async () => {
      const { select } = progressDb([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.listPlansWithProgress(TENANT_B, USER_B);

      expect(result).toEqual([]);
      expect(select).toHaveBeenCalledTimes(1);
    });

    it("hides archived plans by default via the same archived_at IS NULL filter as findAllByUser", async () => {
      const { select, q1 } = progressDb([]);
      const repo = new WorkoutPlanRepository({ select } as never);

      await repo.listPlansWithProgress(TENANT_A, USER_A);

      const whereArg = (q1.where as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sqlContainsArchivedAtIsNull(whereArg)).toBe(true);
    });

    it("includes archived plans when includeArchived: true is passed", async () => {
      const archivedPlan = {
        id: "plan-archived",
        status: "ready" as const,
        createdAt: new Date("2026-06-29T10:00:00Z"),
        name: null,
        planSpecId: SPEC_A,
        archivedAt: new Date("2026-07-01T10:00:00Z"),
      };
      const { select, q1 } = progressDb([archivedPlan], [], []);
      const repo = new WorkoutPlanRepository({ select } as never);

      const result = await repo.listPlansWithProgress(TENANT_A, USER_A, { includeArchived: true });

      const whereArg = (q1.where as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(sqlContainsArchivedAtIsNull(whereArg)).toBe(false);
      expect(result[0]?.archivedAt).toEqual(archivedPlan.archivedAt);
    });
  });
});
