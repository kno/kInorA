import { describe, it, expect, vi } from "vitest";
import { provisionTenantForUser } from "../provisioning.js";

// --- Scenario: New tenant creation (Spec Req 4) ---

describe("provisionTenantForUser", () => {
  it("calls the transaction callback to create tenant, user, and membership", async () => {
    const mockTx = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: "tenant-uuid-1", name: "My Tenant", createdAt: new Date(), updatedAt: new Date() },
          ]),
        }),
      }),
    };

    const mockDb = {
      transaction: vi.fn((fn) => fn(mockTx)),
    } as unknown as {
      transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    };

    // Override mockDb.transaction to call the function with mockTx
    mockDb.transaction = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx));

    const result = await provisionTenantForUser(mockDb, {
      tenantName: "My Tenant",
      userEmail: "owner@example.com",
    });

    expect(result.tenantId).toBe("tenant-uuid-1");
    expect(mockDb.transaction).toHaveBeenCalledOnce();
    expect(mockTx.insert).toHaveBeenCalled();
  });

  it("returns tenantId, userId, and membershipId from the transaction", async () => {
    const mockTx = {
      insert: vi.fn(),
    };

    // Track call order: tenants → users → memberships
    const callOrder: string[] = [];

    mockTx.insert = vi.fn().mockImplementation((table: { _: unknown }) => {
      return {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockImplementation(() => {
            callOrder.push("insert-called");
            if (callOrder.length === 1) {
              return Promise.resolve([{ id: "t-1" }]);
            }
            if (callOrder.length === 2) {
              return Promise.resolve([{ id: "u-1" }]);
            }
            return Promise.resolve([{ id: "m-1" }]);
          }),
        }),
      };
    });

    const mockDb = {
      transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
    } as unknown as {
      transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    };

    const result = await provisionTenantForUser(mockDb, {
      tenantName: "Acme Corp",
      userEmail: "admin@acme.com",
    });

    expect(result).toEqual({
      tenantId: "t-1",
      userId: "u-1",
      membershipId: "m-1",
    });
  });

  // --- Triangulation: a second provisioning call returns different IDs ---

  it("returns different IDs for different provisioning calls", async () => {
    const mockTx = {
      insert: vi.fn(),
    };

    const callOrder: string[] = [];

    mockTx.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(() => {
          callOrder.push("insert-called");
          if (callOrder.length === 1) {
            return Promise.resolve([{ id: "tenant-abc" }]);
          }
          if (callOrder.length === 2) {
            return Promise.resolve([{ id: "user-xyz" }]);
          }
          return Promise.resolve([{ id: "member-789" }]);
        }),
      }),
    }));

    const mockDb = {
      transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
    } as unknown as {
      transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    };

    const result = await provisionTenantForUser(mockDb, {
      tenantName: "Different Corp",
      userEmail: "alt@example.com",
    });

    expect(result.tenantId).toBe("tenant-abc");
    expect(result.userId).toBe("user-xyz");
    expect(result.membershipId).toBe("member-789");
  });

  // --- Scenario: Auth integration deferred (Spec Req 5) ---
  // This primitive does NOT create Auth.js sessions — only DB records.

  it("does not return any session or auth info — only tenantId, userId, membershipId", async () => {
    const mockTx = {
      insert: vi.fn(),
    };

    const callOrder: string[] = [];

    mockTx.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(() => {
          callOrder.push("insert-called");
          if (callOrder.length === 1) return Promise.resolve([{ id: "t-2" }]);
          if (callOrder.length === 2) return Promise.resolve([{ id: "u-2" }]);
          return Promise.resolve([{ id: "m-2" }]);
        }),
      }),
    }));

    const mockDb = {
      transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
    } as unknown as {
      transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    };

    const result = await provisionTenantForUser(mockDb, {
      tenantName: "Test Corp",
      userEmail: "test@example.com",
    });

    const keys = Object.keys(result);
    expect(keys).toEqual(["tenantId", "userId", "membershipId"]);
  });

  it.each([
    [1, /Failed to create tenant/i],
    [2, /Failed to create user/i],
    [3, /Failed to create membership/i],
  ])("fails when insert step %i returns no rows", async (emptyStep, expectedError) => {
    const callOrder: string[] = [];
    const mockTx = {
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockImplementation(() => {
            callOrder.push("insert-called");

            if (callOrder.length === emptyStep) {
              return Promise.resolve([]);
            }

            return Promise.resolve([{ id: `id-${callOrder.length}` }]);
          }),
        }),
      })),
    };

    const mockDb = {
      transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
    } as unknown as Parameters<typeof provisionTenantForUser>[0];

    await expect(
      provisionTenantForUser(mockDb, {
        tenantName: "Test Corp",
        userEmail: "test@example.com",
      })
    ).rejects.toThrow(expectedError);
  });
});
