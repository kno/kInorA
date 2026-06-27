import { describe, it, expect, vi } from "vitest";
import { PlanSpecRepository } from "../plan-spec.js";
import type { PlanSpec } from "@kinora/contracts";

const confirmedSpec: PlanSpec = {
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
  confirmed: true,
};

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";

function planSpecRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "spec-uuid-1",
    tenantId: TENANT_A,
    userId: USER_A,
    specJson: confirmedSpec,
    confirmed: true,
    createdAt: new Date("2026-06-27T12:00:00Z"),
    ...overrides,
  };
}

describe("PlanSpecRepository", () => {
  describe("create", () => {
    it("inserts a confirmed plan_specs row and returns {id, spec}", async () => {
      const row = planSpecRow();
      const returning = vi.fn().mockResolvedValue([row]);
      const values = vi.fn().mockReturnValue({ returning });
      const insert = vi.fn().mockReturnValue({ values });

      const repo = new PlanSpecRepository({ insert } as never);
      const result = await repo.create(TENANT_A, USER_A, confirmedSpec);

      expect(insert).toHaveBeenCalledTimes(1);
      expect(values).toHaveBeenCalledTimes(1);
      expect(returning).toHaveBeenCalledTimes(1);
      expect(result.id).toBe("spec-uuid-1");
      expect(result.spec).toEqual(confirmedSpec);
    });

    it("sets confirmed: true on the inserted row", async () => {
      const row = planSpecRow({ confirmed: true });
      const returning = vi.fn().mockResolvedValue([row]);
      const values = vi.fn().mockReturnValue({ returning });
      const insert = vi.fn().mockReturnValue({ values });

      const repo = new PlanSpecRepository({ insert } as never);
      const result = await repo.create(TENANT_A, USER_A, confirmedSpec);

      // The row should have confirmed: true
      const insertedValues = (values as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Record<string, unknown>;
      expect(insertedValues.confirmed).toBe(true);
      expect(result.id).toBeDefined();
    });

    it("cross-tenant isolation: creates row for tenant B without affecting tenant A", async () => {
      const rowB = planSpecRow({ id: "spec-uuid-2", tenantId: TENANT_B, userId: USER_B });
      const returning = vi.fn().mockResolvedValue([rowB]);
      const values = vi.fn().mockReturnValue({ returning });
      const insert = vi.fn().mockReturnValue({ values });

      const repo = new PlanSpecRepository({ insert } as never);
      const result = await repo.create(TENANT_B, USER_B, confirmedSpec);

      const insertedValues = (values as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Record<string, unknown>;
      expect(insertedValues.tenantId).toBe(TENANT_B);
      expect(insertedValues.userId).toBe(USER_B);
      expect(result.id).toBe("spec-uuid-2");
    });
  });
});
