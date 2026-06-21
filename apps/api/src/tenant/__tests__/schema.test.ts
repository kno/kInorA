import { describe, it, expect } from "vitest";
import { tenants, users, memberships } from "../../db/schema.js";
import { isTable } from "drizzle-orm/table";
import { getTableColumns } from "drizzle-orm/utils";

describe("Drizzle schema shape", () => {
  // --- Scenario: Membership schema supports shared tenant access (Spec Req 1) ---

  it("defines a tenants table", () => {
    expect(isTable(tenants)).toBe(true);
  });

  it("defines a users table", () => {
    expect(isTable(users)).toBe(true);
  });

  it("defines a memberships table", () => {
    expect(isTable(memberships)).toBe(true);
  });

  // --- Scenario: First migration creates tenant foundation (Spec Req 5) ---

  it("tenants table has an id column of type uuid", () => {
    const cols = getTableColumns(tenants);
    expect(cols.id).toBeDefined();
    expect(cols.id.columnType).toBe("PgUUID");
  });

  it("tenants table has a name column of type text", () => {
    const cols = getTableColumns(tenants);
    expect(cols.name).toBeDefined();
    expect(cols.name.columnType).toBe("PgText");
  });

  it("tenants table has createdAt and updatedAt timestamps", () => {
    const cols = getTableColumns(tenants);
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });

  it("users table has an id column of type uuid", () => {
    const cols = getTableColumns(users);
    expect(cols.id).toBeDefined();
    expect(cols.id.columnType).toBe("PgUUID");
  });

  it("users table has an email column of type text", () => {
    const cols = getTableColumns(users);
    expect(cols.email).toBeDefined();
    expect(cols.email.columnType).toBe("PgText");
  });

  it("users table has createdAt and updatedAt timestamps", () => {
    const cols = getTableColumns(users);
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });

  // --- Scenario: Membership schema supports shared tenant access (Spec Req 1) ---
  // --- Scenario: User model is not a single-tenant shortcut (Spec Req 2) ---

  it("memberships table has a tenantId column of type uuid", () => {
    const cols = getTableColumns(memberships);
    expect(cols.tenantId).toBeDefined();
    expect(cols.tenantId.columnType).toBe("PgUUID");
  });

  it("memberships table has a userId column of type uuid", () => {
    const cols = getTableColumns(memberships);
    expect(cols.userId).toBeDefined();
    expect(cols.userId.columnType).toBe("PgUUID");
  });

  it("memberships table has a role column", () => {
    const cols = getTableColumns(memberships);
    expect(cols.role).toBeDefined();
  });

  it("memberships table has a status column", () => {
    const cols = getTableColumns(memberships);
    expect(cols.status).toBeDefined();
  });

  // --- Triangulation: membership structure details ---

  it("memberships table has createdAt timestamp", () => {
    const cols = getTableColumns(memberships);
    expect(cols.createdAt).toBeDefined();
  });

  it("memberships tenantId and userId columns exist for unique constraint", () => {
    const cols = getTableColumns(memberships);
    expect(cols.tenantId).toBeDefined();
    expect(cols.userId).toBeDefined();
    expect(cols.tenantId.columnType).toBe("PgUUID");
    expect(cols.userId.columnType).toBe("PgUUID");
  });
});