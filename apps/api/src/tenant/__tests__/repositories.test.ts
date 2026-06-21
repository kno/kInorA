import { describe, it, expect, vi } from "vitest";
import { TenantRepository } from "../repositories.js";
import type { TenantQueryContext } from "../tenant-context.js";

// --- Scenario: Query without tenant rejected (Spec Req 6) ---
// --- Scenario: Query with tenant context proceeds (Spec Req 7) ---

describe("TenantRepository", () => {
  const validCtx: TenantQueryContext = {
    tenantId: "01912f70-2c5b-7e2e-b8e5-3e7c6a4d2f1a",
  };

  describe("findTenantById", () => {
    it("throws before reaching persistence when tenant context is missing", async () => {
      const mockDb = {
        select: vi.fn(),
      };

      const repo = new TenantRepository(mockDb as never);
      const nullCtx = null as unknown as TenantQueryContext;

      await expect(repo.findTenantById(nullCtx, "some-id")).rejects.toThrow(
        /tenant context.*required/i
      );

      // Persistence should NEVER have been called
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it("queries the tenant identified by ctx.tenantId and returns its row", async () => {
      const where = vi.fn().mockResolvedValue([
        { id: validCtx.tenantId, name: "Test Tenant" },
      ]);
      const from = vi.fn().mockReturnValue({ where });
      const mockSelect = vi.fn().mockReturnValue({ from });

      const mockDb = { select: mockSelect };
      const repo = new TenantRepository(mockDb as never);

      const result = await repo.findTenantById(validCtx, validCtx.tenantId);

      expect(mockSelect).toHaveBeenCalledTimes(1);
      expect(from).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: validCtx.tenantId, name: "Test Tenant" });
    });

    // Mismatch case: a valid context MUST NOT be used to fetch a different
    // tenant's data. The call MUST fail before reaching persistence.
    it("throws before reaching persistence when id does not match ctx.tenantId", async () => {
      const mockSelect = vi.fn();
      const mockDb = { select: mockSelect };
      const repo = new TenantRepository(mockDb as never);

      await expect(
        repo.findTenantById(validCtx, "different-tenant-id")
      ).rejects.toThrow(/mismatch/i);

      // Persistence MUST never have been called
      expect(mockSelect).not.toHaveBeenCalled();
    });

    // Triangulate match: a different valid context queries its own tenant
    it("queries the tenant when id matches a different ctx.tenantId", async () => {
      const otherCtx: TenantQueryContext = {
        tenantId: "01912f70-2c5b-7e2e-b8e5-3e7c6a4d2fab",
      };
      const where = vi
        .fn()
        .mockResolvedValue([{ id: otherCtx.tenantId, name: "Other Tenant" }]);
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });

      const mockDb = { select };
      const repo = new TenantRepository(mockDb as never);

      const result = await repo.findTenantById(otherCtx, otherCtx.tenantId);

      expect(result).toEqual({ id: otherCtx.tenantId, name: "Other Tenant" });
      expect(where).toHaveBeenCalledTimes(1);
    });

    // Edge case: matching ctx+id but row not found returns null
    it("returns null when no row matches the tenant-scoped query", async () => {
      const where = vi.fn().mockResolvedValue([]);
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });

      const mockDb = { select };
      const repo = new TenantRepository(mockDb as never);

      const result = await repo.findTenantById(validCtx, validCtx.tenantId);

      expect(result).toBeNull();
      expect(where).toHaveBeenCalledTimes(1);
    });

    // Triangulation: empty string tenantId also rejected
    it("throws before reaching persistence when tenantId is empty string", async () => {
      const mockDb = {
        select: vi.fn(),
      };

      const repo = new TenantRepository(mockDb as never);
      const emptyCtx: TenantQueryContext = { tenantId: "" };

      await expect(repo.findTenantById(emptyCtx, "some-id")).rejects.toThrow(
        /tenant context.*required/i
      );

      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe("findMembershipsByTenant", () => {
    it("throws before reaching persistence when tenant context is missing", async () => {
      const mockDb = {
        select: vi.fn(),
      };

      const repo = new TenantRepository(mockDb as never);
      const undefinedCtx = undefined as unknown as TenantQueryContext;

      await expect(
        repo.findMembershipsByTenant(undefinedCtx)
      ).rejects.toThrow(/tenant context.*required/i);

      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it("delegates to persistence when valid tenant context is provided", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: "m-1", tenantId: "t-1", userId: "u-1", role: "owner", status: "active" },
          ]),
        }),
      });

      const mockDb = { select: mockSelect };
      const repo = new TenantRepository(mockDb as never);

      const result = await repo.findMembershipsByTenant(validCtx);

      expect(mockSelect).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].tenantId).toBe("t-1");
    });
  });
});