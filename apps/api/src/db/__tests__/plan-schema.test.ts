import { describe, it, expect } from "vitest";
import { isTable } from "drizzle-orm/table";
import { getTableColumns } from "drizzle-orm/utils";

// These imports will fail (RED) until plan_drafts and plan_specs are added to schema.ts
import { planDrafts, planSpecs } from "../schema.js";

describe("plan_drafts schema shape", () => {
  it("defines a plan_drafts table", () => {
    expect(isTable(planDrafts)).toBe(true);
  });

  it("plan_drafts table has an id uuid pk column", () => {
    const cols = getTableColumns(planDrafts);
    expect(cols.id).toBeDefined();
    expect(cols.id.columnType).toBe("PgUUID");
  });

  it("plan_drafts table has a tenant_id uuid column", () => {
    const cols = getTableColumns(planDrafts);
    expect(cols.tenantId).toBeDefined();
    expect(cols.tenantId.columnType).toBe("PgUUID");
  });

  it("plan_drafts table has a user_id uuid column", () => {
    const cols = getTableColumns(planDrafts);
    expect(cols.userId).toBeDefined();
    expect(cols.userId.columnType).toBe("PgUUID");
  });

  it("plan_drafts table has a step integer column", () => {
    const cols = getTableColumns(planDrafts);
    expect(cols.step).toBeDefined();
    expect(cols.step.columnType).toBe("PgInteger");
  });

  it("plan_drafts table has a spec_json jsonb column", () => {
    const cols = getTableColumns(planDrafts);
    expect(cols.specJson).toBeDefined();
    expect(cols.specJson.columnType).toBe("PgJsonb");
  });

  it("plan_drafts table has an updated_at timestamp column", () => {
    const cols = getTableColumns(planDrafts);
    expect(cols.updatedAt).toBeDefined();
  });
});

describe("plan_specs schema shape", () => {
  it("defines a plan_specs table", () => {
    expect(isTable(planSpecs)).toBe(true);
  });

  it("plan_specs table has an id uuid pk column", () => {
    const cols = getTableColumns(planSpecs);
    expect(cols.id).toBeDefined();
    expect(cols.id.columnType).toBe("PgUUID");
  });

  it("plan_specs table has a tenant_id uuid column", () => {
    const cols = getTableColumns(planSpecs);
    expect(cols.tenantId).toBeDefined();
    expect(cols.tenantId.columnType).toBe("PgUUID");
  });

  it("plan_specs table has a user_id uuid column", () => {
    const cols = getTableColumns(planSpecs);
    expect(cols.userId).toBeDefined();
    expect(cols.userId.columnType).toBe("PgUUID");
  });

  it("plan_specs table has a spec_json jsonb column", () => {
    const cols = getTableColumns(planSpecs);
    expect(cols.specJson).toBeDefined();
    expect(cols.specJson.columnType).toBe("PgJsonb");
  });

  it("plan_specs table has a confirmed boolean column", () => {
    const cols = getTableColumns(planSpecs);
    expect(cols.confirmed).toBeDefined();
    expect(cols.confirmed.columnType).toBe("PgBoolean");
  });

  it("plan_specs table has a created_at timestamp column", () => {
    const cols = getTableColumns(planSpecs);
    expect(cols.createdAt).toBeDefined();
  });
});
