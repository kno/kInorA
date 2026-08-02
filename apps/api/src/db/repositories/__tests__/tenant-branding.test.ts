import { describe, it, expect, vi } from "vitest";
import { TenantBrandingRepository, TenantBrandingSlugConflictError } from "../tenant-branding.js";

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000001";

function brandingRow(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_A,
    subdomainSlug: "gym-a",
    logoStorageKey: null,
    accent: "#112233",
    accentFg: null,
    surface: null,
    surface2: null,
    fg: null,
    muted: null,
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
  const doUpdate = vi.fn().mockResolvedValue(rows);
  const returning = vi.fn().mockReturnValue({ then: undefined }); // unused fallback
  const target = vi.fn();
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(rows) });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate, returning: vi.fn().mockResolvedValue(rows) });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, onConflictDoUpdate, target, returning, doUpdate };
}

/**
 * TenantBrandingRepository (16a-v3-gym-white-label, Slice 1 — dark, no route
 * wiring yet). Tenant-scoped like every other repository in this codebase:
 * every read filters by `tenantId` (or, for the public slug lookup, is
 * exposed as read-only and returns only the columns the public endpoint
 * needs — the actual PUBLIC route lands in Slice 3).
 */
describe("TenantBrandingRepository (16a-v3-gym-white-label Slice 1 — dark, no route wiring)", () => {
  describe("findByTenantId", () => {
    it("returns the branding row for the given tenant", async () => {
      const row = brandingRow();
      const { select } = selectChain([row]);
      const repo = new TenantBrandingRepository({ select } as never);

      const result = await repo.findByTenantId(TENANT_A);

      expect(result).toEqual(
        expect.objectContaining({ tenantId: TENANT_A, subdomainSlug: "gym-a" }),
      );
    });

    it("returns undefined when no branding row exists for the tenant", async () => {
      const { select } = selectChain([]);
      const repo = new TenantBrandingRepository({ select } as never);

      const result = await repo.findByTenantId(TENANT_B);

      expect(result).toBeUndefined();
    });
  });

  describe("findBySubdomainSlug", () => {
    it("returns the branding row matching the slug", async () => {
      const row = brandingRow({ subdomainSlug: "gym-b", tenantId: TENANT_B });
      const { select } = selectChain([row]);
      const repo = new TenantBrandingRepository({ select } as never);

      const result = await repo.findBySubdomainSlug("gym-b");

      expect(result).toEqual(expect.objectContaining({ subdomainSlug: "gym-b" }));
    });

    it("returns undefined for an unknown slug", async () => {
      const { select } = selectChain([]);
      const repo = new TenantBrandingRepository({ select } as never);

      const result = await repo.findBySubdomainSlug("unknown-slug");

      expect(result).toBeUndefined();
    });
  });

  describe("upsert", () => {
    it("inserts/updates the branding row scoped to the given tenant", async () => {
      const row = brandingRow({ accent: "#ffffff" });
      const { insert, values, onConflictDoUpdate } = insertChain([row]);
      const repo = new TenantBrandingRepository({ insert } as never);

      const result = await repo.upsert(TENANT_A, {
        subdomainSlug: "gym-a",
        logoStorageKey: null,
        accent: "#ffffff",
        accentFg: null,
        surface: null,
        surface2: null,
        fg: null,
        muted: null,
      });

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_A, subdomainSlug: "gym-a", accent: "#ffffff" }),
      );
      expect(onConflictDoUpdate).toHaveBeenCalled();
      expect(result.palette).toEqual(expect.objectContaining({ accent: "#ffffff" }));
    });

    it("translates a Postgres unique-violation (23505) into TenantBrandingSlugConflictError (Slice 3, duplicate slug → 409 not 500)", async () => {
      const uniqueViolation = Object.assign(new Error("duplicate key value"), { code: "23505" });
      const onConflictDoUpdate = vi.fn().mockReturnValue({
        returning: vi.fn().mockRejectedValue(uniqueViolation),
      });
      const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
      const insert = vi.fn().mockReturnValue({ values });
      const repo = new TenantBrandingRepository({ insert } as never);

      await expect(
        repo.upsert(TENANT_A, {
          subdomainSlug: "already-taken",
          logoStorageKey: null,
          accent: null,
          accentFg: null,
          surface: null,
          surface2: null,
          fg: null,
          muted: null,
        }),
      ).rejects.toThrow(TenantBrandingSlugConflictError);
    });
  });
});
