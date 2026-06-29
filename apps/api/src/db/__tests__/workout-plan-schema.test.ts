import { describe, it, expect } from "vitest";
import { isTable } from "drizzle-orm/table";
import { getTableColumns } from "drizzle-orm/utils";

// These imports will fail (RED) until workoutPlanStatusEnum and workoutPlans are added to schema.ts
import { workoutPlanStatusEnum, workoutPlans } from "../schema.js";

describe("workout_plan_status enum", () => {
  it("exposes the generating value", () => {
    expect(workoutPlanStatusEnum.enumValues).toContain("generating");
  });

  it("exposes the ready value", () => {
    expect(workoutPlanStatusEnum.enumValues).toContain("ready");
  });

  it("exposes the failed value", () => {
    expect(workoutPlanStatusEnum.enumValues).toContain("failed");
  });

  it("has exactly three values", () => {
    expect(workoutPlanStatusEnum.enumValues).toHaveLength(3);
  });
});

describe("workout_plans schema shape", () => {
  it("defines a workout_plans table", () => {
    expect(isTable(workoutPlans)).toBe(true);
  });

  it("has an id uuid pk column", () => {
    const cols = getTableColumns(workoutPlans);
    expect(cols.id).toBeDefined();
    expect(cols.id.columnType).toBe("PgUUID");
  });

  it("has a tenant_id uuid column", () => {
    const cols = getTableColumns(workoutPlans);
    expect(cols.tenantId).toBeDefined();
    expect(cols.tenantId.columnType).toBe("PgUUID");
  });

  it("has a user_id uuid column", () => {
    const cols = getTableColumns(workoutPlans);
    expect(cols.userId).toBeDefined();
    expect(cols.userId.columnType).toBe("PgUUID");
  });

  it("has a plan_spec_id uuid column", () => {
    const cols = getTableColumns(workoutPlans);
    expect(cols.planSpecId).toBeDefined();
    expect(cols.planSpecId.columnType).toBe("PgUUID");
  });

  it("has a status column using the workout_plan_status enum", () => {
    const cols = getTableColumns(workoutPlans);
    expect(cols.status).toBeDefined();
    expect(cols.status.columnType).toBe("PgEnumColumn");
  });

  it("has a program_json jsonb column", () => {
    const cols = getTableColumns(workoutPlans);
    expect(cols.programJson).toBeDefined();
    expect(cols.programJson.columnType).toBe("PgJsonb");
  });

  it("has an error_message text column (nullable)", () => {
    const cols = getTableColumns(workoutPlans);
    expect(cols.errorMessage).toBeDefined();
    expect(cols.errorMessage.columnType).toBe("PgText");
  });

  it("has a created_at timestamp column", () => {
    const cols = getTableColumns(workoutPlans);
    expect(cols.createdAt).toBeDefined();
  });

  it("has an updated_at timestamp column", () => {
    const cols = getTableColumns(workoutPlans);
    expect(cols.updatedAt).toBeDefined();
  });
});
