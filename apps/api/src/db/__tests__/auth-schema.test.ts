import { describe, it, expect } from "vitest";
import { credentials, oauth_accounts, sessions } from "../schema.js";
import { isTable } from "drizzle-orm/table";
import { getTableColumns } from "drizzle-orm/utils";

describe("auth schema shape", () => {
  // --- Scenario: Password credentials are stored per user (Spec: credentials table) ---

  it("defines a credentials table", () => {
    expect(isTable(credentials)).toBe(true);
  });

  it("credentials table has a userId uuid column", () => {
    const cols = getTableColumns(credentials);
    expect(cols.userId).toBeDefined();
    expect(cols.userId.columnType).toBe("PgUUID");
  });

  it("credentials table has a passwordHash text column", () => {
    const cols = getTableColumns(credentials);
    expect(cols.passwordHash).toBeDefined();
    expect(cols.passwordHash.columnType).toBe("PgText");
  });

  it("credentials table has a createdAt timestamp", () => {
    const cols = getTableColumns(credentials);
    expect(cols.createdAt).toBeDefined();
  });

  // --- Scenario: OAuth accounts link providers to users by verified email ---

  it("defines an oauth_accounts table", () => {
    expect(isTable(oauth_accounts)).toBe(true);
  });

  it("oauth_accounts table has providerId and providerAccountId text columns", () => {
    const cols = getTableColumns(oauth_accounts);
    expect(cols.providerId).toBeDefined();
    expect(cols.providerId.columnType).toBe("PgText");
    expect(cols.providerAccountId).toBeDefined();
    expect(cols.providerAccountId.columnType).toBe("PgText");
  });

  it("oauth_accounts table has an email text column", () => {
    const cols = getTableColumns(oauth_accounts);
    expect(cols.email).toBeDefined();
    expect(cols.email.columnType).toBe("PgText");
  });

  it("oauth_accounts table has a userId uuid column", () => {
    const cols = getTableColumns(oauth_accounts);
    expect(cols.userId).toBeDefined();
    expect(cols.userId.columnType).toBe("PgUUID");
  });

  it("oauth_accounts table has a createdAt timestamp", () => {
    const cols = getTableColumns(oauth_accounts);
    expect(cols.createdAt).toBeDefined();
  });

  // --- Scenario: Sessions are opaque DB-backed bearer tokens ---

  it("defines a sessions table", () => {
    expect(isTable(sessions)).toBe(true);
  });

  it("sessions table has a tokenHash text column", () => {
    const cols = getTableColumns(sessions);
    expect(cols.tokenHash).toBeDefined();
    expect(cols.tokenHash.columnType).toBe("PgText");
  });

  it("sessions table has userId and tenantId uuid columns", () => {
    const cols = getTableColumns(sessions);
    expect(cols.userId).toBeDefined();
    expect(cols.userId.columnType).toBe("PgUUID");
    expect(cols.tenantId).toBeDefined();
    expect(cols.tenantId.columnType).toBe("PgUUID");
  });

  it("sessions table has createdAt and expiresAt timestamps", () => {
    const cols = getTableColumns(sessions);
    expect(cols.createdAt).toBeDefined();
    expect(cols.expiresAt).toBeDefined();
  });
});