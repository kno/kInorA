import { describe, it, expect, vi } from "vitest";
import {
  CredentialsRepository,
  type CredentialRecord,
} from "../credentials.js";
import {
  UserRepository,
  MembershipRepository,
  TenantLookupRepository,
  type UserRecord,
  type MembershipRecord,
  type TenantRecord,
} from "../auth-context.js";
import { selectChain } from "../../../test-support/auth-mocks.js";

// --- Test fixtures ---

const credential: CredentialRecord = {
  userId: "user-uuid-1",
  passwordHash: "N:r:p:keylen:salt:hash",
  createdAt: new Date("2026-06-22T12:00:00Z"),
};

const user: UserRecord = {
  id: "user-uuid-1",
  email: "user@example.com",
  createdAt: new Date("2026-06-22T12:00:00Z"),
  updatedAt: new Date("2026-06-22T12:00:00Z"),
};

const membership: MembershipRecord = {
  id: "member-uuid-1",
  tenantId: "tenant-uuid-1",
  userId: "user-uuid-1",
  role: "owner",
  status: "active",
  createdAt: new Date("2026-06-22T12:00:00Z"),
};

const tenant: TenantRecord = {
  id: "tenant-uuid-1",
  name: "user's workspace",
  createdAt: new Date("2026-06-22T12:00:00Z"),
  updatedAt: new Date("2026-06-22T12:00:00Z"),
};

// --- Mock helpers ---
// selectChain (the low-level `select().from().where()` chain) is shared with the
// auth suites via the test-support module.

// --- CredentialsRepository ---

describe("CredentialsRepository", () => {
  describe("findByUserId", () => {
    it("returns the credential row when it exists", async () => {
      const mockSelect = vi.fn().mockReturnValue(selectChain([credential]));
      const repo = new CredentialsRepository({ select: mockSelect } as never);

      const result = await repo.findByUserId("user-uuid-1");

      expect(result).toEqual(credential);
    });

    it("returns null when no credential exists", async () => {
      const mockSelect = vi.fn().mockReturnValue(selectChain([]));
      const repo = new CredentialsRepository({ select: mockSelect } as never);

      const result = await repo.findByUserId("nobody");

      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("inserts a credential row", async () => {
      const valuesResult: Record<string, unknown> = {};
      valuesResult.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(undefined).then(resolve);
      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue(valuesResult),
      });
      const repo = new CredentialsRepository({ insert: mockInsert } as never);

      await repo.create({ userId: "u-1", passwordHash: "hash" });

      expect(mockInsert).toHaveBeenCalledTimes(1);
    });
  });
});

// --- UserRepository ---

describe("UserRepository", () => {
  it("returns the user when email matches", async () => {
    const mockSelect = vi.fn().mockReturnValue(selectChain([user]));
    const repo = new UserRepository({ select: mockSelect } as never);

    const result = await repo.findByEmail("user@example.com");

    expect(result).toEqual(user);
  });

  it("returns null when no user matches the email", async () => {
    const mockSelect = vi.fn().mockReturnValue(selectChain([]));
    const repo = new UserRepository({ select: mockSelect } as never);

    const result = await repo.findByEmail("nobody@example.com");

    expect(result).toBeNull();
  });
});

// --- MembershipRepository ---

describe("MembershipRepository", () => {
  describe("findFirstByUserId", () => {
    it("returns the first membership for a user", async () => {
      const mockSelect = vi.fn().mockReturnValue(selectChain([membership]));
      const repo = new MembershipRepository({ select: mockSelect } as never);

      const result = await repo.findFirstByUserId("user-uuid-1");

      expect(result).toEqual(membership);
    });

    it("returns null when the user has no memberships", async () => {
      const mockSelect = vi.fn().mockReturnValue(selectChain([]));
      const repo = new MembershipRepository({ select: mockSelect } as never);

      const result = await repo.findFirstByUserId("orphan");

      expect(result).toBeNull();
    });
  });

  describe("findActiveByUserId", () => {
    it("returns the active membership for a user", async () => {
      const mockSelect = vi.fn().mockReturnValue(selectChain([membership]));
      const repo = new MembershipRepository({ select: mockSelect } as never);

      const result = await repo.findActiveByUserId("user-uuid-1");

      expect(result).toEqual(membership);
      expect(result?.status).toBe("active");
    });

    it("returns null when the user has no memberships", async () => {
      const mockSelect = vi.fn().mockReturnValue(selectChain([]));
      const repo = new MembershipRepository({ select: mockSelect } as never);

      const result = await repo.findActiveByUserId("orphan");

      expect(result).toBeNull();
    });

    it("returns null when the active-only filter excludes non-active memberships", async () => {
      // The DB-level filter (status = "active") returns empty for suspended/invited users.
      // This simulates the active-only WHERE clause filtering out non-active rows.
      const mockSelect = vi.fn().mockReturnValue(selectChain([]));
      const repo = new MembershipRepository({ select: mockSelect } as never);

      const result = await repo.findActiveByUserId("suspended-user");

      expect(result).toBeNull();
    });
  });

  describe("findByTenantAndUser", () => {
    it("returns the membership scoped to the (tenantId, userId) pair", async () => {
      const mockSelect = vi.fn().mockReturnValue(selectChain([membership]));
      const repo = new MembershipRepository({ select: mockSelect } as never);

      const result = await repo.findByTenantAndUser(
        "tenant-uuid-1",
        "user-uuid-1"
      );

      expect(result).toEqual(membership);
      expect(mockSelect).toHaveBeenCalledTimes(1);
    });

    it("returns null when the user has no membership in that tenant", async () => {
      const mockSelect = vi.fn().mockReturnValue(selectChain([]));
      const repo = new MembershipRepository({ select: mockSelect } as never);

      const result = await repo.findByTenantAndUser(
        "tenant-other",
        "user-uuid-1"
      );

      expect(result).toBeNull();
    });
  });
});

// --- TenantLookupRepository ---

describe("TenantLookupRepository", () => {
  it("returns the tenant when id matches", async () => {
    const mockSelect = vi.fn().mockReturnValue(selectChain([tenant]));
    const repo = new TenantLookupRepository({ select: mockSelect } as never);

    const result = await repo.findById("tenant-uuid-1");

    expect(result).toEqual(tenant);
  });

  it("returns null when no tenant matches the id", async () => {
    const mockSelect = vi.fn().mockReturnValue(selectChain([]));
    const repo = new TenantLookupRepository({ select: mockSelect } as never);

    const result = await repo.findById("nonexistent");

    expect(result).toBeNull();
  });
});