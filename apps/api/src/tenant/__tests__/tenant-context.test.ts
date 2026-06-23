import { describe, it, expect } from "vitest";
import {
  assertTenantContext,
  assertTenantIdMatchesContext,
  extractTenantQueryContext,
  type TenantQueryContext,
} from "../tenant-context.js";
import type { SessionContext } from "@kinora/contracts";

// --- Scenario: Query without tenant rejected (Spec Req 6) ---

describe("assertTenantContext", () => {
  it("throws when tenantId is missing (undefined)", () => {
    const ctx: TenantQueryContext = { tenantId: undefined as unknown as string };
    expect(() => assertTenantContext(ctx)).toThrow(
      /tenant context.*required/i
    );
  });

  it("throws when tenantId is an empty string", () => {
    const ctx: TenantQueryContext = { tenantId: "" };
    expect(() => assertTenantContext(ctx)).toThrow(
      /tenant context.*required/i
    );
  });

  it("throws when context is null", () => {
    expect(() => assertTenantContext(null as unknown as TenantQueryContext)).toThrow(
      /tenant context.*required/i
    );
  });

  it("throws when context is undefined", () => {
    expect(() =>
      assertTenantContext(undefined as unknown as TenantQueryContext)
    ).toThrow(/tenant context.*required/i);
  });

  // --- Scenario: Query with tenant context proceeds (Spec Req 7) ---

  it("does not throw when tenantId is a valid non-empty string", () => {
    const ctx: TenantQueryContext = { tenantId: "01912f70-2c5b-7e2e-b8e5-3e7c6a4d2f1a" };
    expect(() => assertTenantContext(ctx)).not.toThrow();
  });

  // --- Triangulation: different valid tenant IDs pass ---

  it("does not throw for a different valid tenantId", () => {
    const ctx: TenantQueryContext = { tenantId: "550e8400-e29b-41d4-a716-446655440000" };
    expect(() => assertTenantContext(ctx)).not.toThrow();
  });

  it("does not throw when actorUserId is present alongside tenantId", () => {
    const ctx: TenantQueryContext = {
      tenantId: "01912f70-2c5b-7e2e-b8e5-3e7c6a4d2f1a",
      actorUserId: "550e8400-e29b-41d4-a716-446655440000",
    };
    expect(() => assertTenantContext(ctx)).not.toThrow();
  });
});

// --- Scenario: Query with tenant context proceeds (Spec Req 7) ---
// The repository MUST be tenant-scoped at runtime: a valid context cannot be
// used to fetch a different tenant's data. This contract is enforced by
// `assertTenantIdMatchesContext`, used by repository queries that take an id.

describe("assertTenantIdMatchesContext", () => {
  const tenantA: TenantQueryContext = { tenantId: "tenant-a-id" };
  const tenantB: TenantQueryContext = { tenantId: "tenant-b-id" };

  it("throws when id does not match ctx.tenantId", () => {
    expect(() => assertTenantIdMatchesContext(tenantA, "tenant-b-id")).toThrow(
      /mismatch/i
    );
  });

  it("does not throw when id matches ctx.tenantId", () => {
    expect(() =>
      assertTenantIdMatchesContext(tenantA, "tenant-a-id")
    ).not.toThrow();
  });

  // Triangulate: mismatch in the reverse direction
  it("throws when ctx.tenantId=B and id=A (reverse direction)", () => {
    expect(() =>
      assertTenantIdMatchesContext(tenantB, "tenant-a-id")
    ).toThrow(/mismatch/i);
  });

  // Triangulate: different matching values
  it("does not throw when id matches a different valid ctx.tenantId", () => {
    expect(() =>
      assertTenantIdMatchesContext(tenantB, "tenant-b-id")
    ).not.toThrow();
  });

  // Triangulate: missing id (undefined / null) is also a scope violation
  it("throws when id is undefined", () => {
    expect(() =>
      assertTenantIdMatchesContext(tenantA, undefined as unknown as string)
    ).toThrow(/mismatch/i);
  });

  it("throws when id is an empty string", () => {
    expect(() => assertTenantIdMatchesContext(tenantA, "")).toThrow(/mismatch/i);
  });

  // Delegates context validation: missing context still rejected before id check
  it("throws when context is null (delegated context validation)", () => {
    expect(() =>
      assertTenantIdMatchesContext(
        null as unknown as TenantQueryContext,
        "tenant-a-id"
      )
    ).toThrow(/tenant context.*required/i);
  });

  it("throws when context.tenantId is empty string (delegated context validation)", () => {
    const emptyCtx = { tenantId: "" } as TenantQueryContext;
    expect(() => assertTenantIdMatchesContext(emptyCtx, "")).toThrow(
      /tenant context.*required/i
    );
  });
});

// --- Scenario: extractTenantQueryContext (05b) ---
// Derives a TenantQueryContext from the request's authContext so repository
// guards receive tenant + actor identity without re-reading the session.

describe("extractTenantQueryContext", () => {
  function makeSessionContext(
    userId: string,
    tenantId: string,
    sessionId: string = "a".repeat(64)
  ): SessionContext {
    return {
      userId: userId as unknown as SessionContext["userId"],
      tenantId: tenantId as unknown as SessionContext["tenantId"],
      sessionId: sessionId as unknown as SessionContext["sessionId"],
    };
  }

  it("extracts TenantQueryContext from a valid authContext", () => {
    const authContext = makeSessionContext("user-uuid-1", "tenant-uuid-1");

    const result = extractTenantQueryContext({ authContext });

    expect(result.tenantId).toBe("tenant-uuid-1");
    expect(result.actorUserId).toBe("user-uuid-1");
  });

  it("throws when authContext is null", () => {
    expect(() => extractTenantQueryContext({ authContext: null })).toThrow(
      "Cannot extract tenant context: authContext is null"
    );
  });

  // Triangle: different tenant/user values produce different contexts
  it("extracts correct fields for a different tenant and user", () => {
    const authContext = makeSessionContext("user-uuid-2", "tenant-uuid-2");

    const result = extractTenantQueryContext({ authContext });

    expect(result.tenantId).toBe("tenant-uuid-2");
    expect(result.actorUserId).toBe("user-uuid-2");
  });

  // Triangle: sessionId is NOT included in TenantQueryContext (only tenant + actor)
  it("does not include sessionId in the returned context", () => {
    const authContext = makeSessionContext("user-1", "tenant-1", "b".repeat(64));

    const result = extractTenantQueryContext({ authContext });

    expect(result).not.toHaveProperty("sessionId");
    expect(Object.keys(result).sort()).toEqual(["actorUserId", "tenantId"]);
  });
});