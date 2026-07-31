import { describe, it, expect, vi } from "vitest";
import { TrainerAssignmentRepository } from "../trainer-assignment.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const TRAINER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const CLIENT_A = "aaaaaaaa-0000-0000-0000-000000000003";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000001";

function assignmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "assignment-uuid-1",
    tenantId: TENANT_A,
    trainerUserId: TRAINER_A,
    clientUserId: CLIENT_A,
    status: "active",
    ...overrides,
  };
}

function selectChain(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select };
}

function insertChain(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, returning };
}

function updateChain(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { update, set, where, returning };
}

describe("TrainerAssignmentRepository (15a-v2 Slice 1 — dark, no route wiring)", () => {
  describe("create", () => {
    it("inserts a new assignment defaulting to status 'invited'", async () => {
      const row = assignmentRow({ status: "invited" });
      const { insert, values } = insertChain([row]);
      const repo = new TrainerAssignmentRepository({ insert } as never);

      const result = await repo.create(TENANT_A, TRAINER_A, CLIENT_A);

      expect(values).toHaveBeenCalledWith({
        tenantId: TENANT_A,
        trainerUserId: TRAINER_A,
        clientUserId: CLIENT_A,
        status: "invited",
      });
      expect(result).toEqual({
        id: "assignment-uuid-1",
        tenantId: TENANT_A,
        trainerUserId: TRAINER_A,
        clientUserId: CLIENT_A,
        status: "invited",
      });
    });

    it("accepts an explicit status override", async () => {
      const row = assignmentRow({ status: "active" });
      const { insert, values } = insertChain([row]);
      const repo = new TrainerAssignmentRepository({ insert } as never);

      await repo.create(TENANT_A, TRAINER_A, CLIENT_A, "active");

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({ status: "active" }),
      );
    });
  });

  describe("findActiveAssignment", () => {
    it("returns the assignment when an active row matches tenant+trainer+client", async () => {
      const row = assignmentRow({ status: "active" });
      const { select } = selectChain([row]);
      const repo = new TrainerAssignmentRepository({ select } as never);

      const result = await repo.findActiveAssignment(TENANT_A, TRAINER_A, CLIENT_A);

      expect(result).toEqual({
        id: "assignment-uuid-1",
        tenantId: TENANT_A,
        trainerUserId: TRAINER_A,
        clientUserId: CLIENT_A,
        status: "active",
      });
    });

    it("returns undefined when no row matches (missing assignment)", async () => {
      const { select } = selectChain([]);
      const repo = new TrainerAssignmentRepository({ select } as never);

      const result = await repo.findActiveAssignment(TENANT_A, TRAINER_A, CLIENT_A);

      expect(result).toBeUndefined();
    });

    it("returns undefined for a revoked assignment (query is status-scoped to 'active')", async () => {
      // The repository's WHERE clause filters on status = 'active' at the SQL
      // level, so a revoked row is never among the returned rows in the first
      // place — this proves the mock reflects that (empty result set).
      const { select } = selectChain([]);
      const repo = new TrainerAssignmentRepository({ select } as never);

      const result = await repo.findActiveAssignment(TENANT_A, TRAINER_A, CLIENT_A);

      expect(result).toBeUndefined();
    });

    it("never returns a row belonging to a different tenant", async () => {
      // Simulates tenant isolation: querying with TENANT_B while only a
      // TENANT_A row exists returns nothing (the mock stands in for the
      // tenantId WHERE clause actually filtering server-side).
      const { select } = selectChain([]);
      const repo = new TrainerAssignmentRepository({ select } as never);

      const result = await repo.findActiveAssignment(TENANT_B, TRAINER_A, CLIENT_A);

      expect(result).toBeUndefined();
    });
  });

  describe("listByTrainer", () => {
    it("maps every assignment row for the given tenant+trainer", async () => {
      const rows = [
        assignmentRow({ id: "a1", status: "active" }),
        assignmentRow({ id: "a2", clientUserId: "client-2", status: "invited" }),
      ];
      const { select } = selectChain(rows);
      const repo = new TrainerAssignmentRepository({ select } as never);

      const result = await repo.listByTrainer(TENANT_A, TRAINER_A);

      expect(result).toEqual([
        { id: "a1", tenantId: TENANT_A, trainerUserId: TRAINER_A, clientUserId: CLIENT_A, status: "active" },
        { id: "a2", tenantId: TENANT_A, trainerUserId: TRAINER_A, clientUserId: "client-2", status: "invited" },
      ]);
    });

    it("returns an empty array when the trainer has no assignments", async () => {
      const { select } = selectChain([]);
      const repo = new TrainerAssignmentRepository({ select } as never);

      const result = await repo.listByTrainer(TENANT_A, TRAINER_A);

      expect(result).toEqual([]);
    });
  });

  describe("updateStatus", () => {
    it("returns 1 when the tenant-scoped row is updated", async () => {
      const { update } = updateChain([assignmentRow({ status: "revoked" })]);
      const repo = new TrainerAssignmentRepository({ update } as never);

      const result = await repo.updateStatus(TENANT_A, "assignment-uuid-1", "revoked");

      expect(result).toBe(1);
    });

    it("returns 0 when the id does not belong to this tenant (no cross-tenant update)", async () => {
      const { update } = updateChain([]);
      const repo = new TrainerAssignmentRepository({ update } as never);

      const result = await repo.updateStatus(TENANT_B, "assignment-uuid-1", "revoked");

      expect(result).toBe(0);
    });
  });
});
