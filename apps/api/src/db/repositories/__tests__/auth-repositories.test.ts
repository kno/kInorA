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

    // 15a-v2-trainer-account-access Slice 2 (task 2.8): the returned row must
    // include `role` (already present in the selected columns — this asserts
    // the type accepts the widened `trainer` role value too, since
    // resolveAuthorizedOwner/SessionContext.role are populated from this read).
    it("returns a role of 'trainer' when the membership row has that role", async () => {
      const trainerMembership: MembershipRecord = {
        ...membership,
        role: "trainer",
      };
      const mockSelect = vi.fn().mockReturnValue(selectChain([trainerMembership]));
      const repo = new MembershipRepository({ select: mockSelect } as never);

      const result = await repo.findByTenantAndUser(
        "tenant-uuid-1",
        "user-uuid-1"
      );

      expect(result?.role).toBe("trainer");
    });
  });

  // 15a-v2-trainer-account-access Slice 3 (tasks 3.2/3.3): invite/accept flow
  // needs to CREATE and TRANSITION membership rows, not just read them.
  describe("create", () => {
    it("inserts a new membership row with the given role and status", async () => {
      const inserted = { ...membership, role: "member", status: "invited" };
      const returning = vi.fn().mockResolvedValue([inserted]);
      const values = vi.fn().mockReturnValue({ returning });
      const insert = vi.fn().mockReturnValue({ values });
      const repo = new MembershipRepository({ insert } as never);

      const result = await repo.create("tenant-uuid-1", "user-uuid-1", "member", "invited");

      expect(values).toHaveBeenCalledWith({
        tenantId: "tenant-uuid-1",
        userId: "user-uuid-1",
        role: "member",
        status: "invited",
      });
      expect(result).toEqual(inserted);
    });
  });

  describe("upsertInvited", () => {
    it("inserts or resets an existing (tenantId, userId) row to invited", async () => {
      const upserted = { ...membership, role: "member", status: "invited" };
      const returning = vi.fn().mockResolvedValue([upserted]);
      const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
      const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
      const insert = vi.fn().mockReturnValue({ values });
      const repo = new MembershipRepository({ insert } as never);

      const result = await repo.upsertInvited("tenant-uuid-1", "user-uuid-1", "member");

      expect(result).toEqual(upserted);
      expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe("updateStatusByTenantAndUser", () => {
    it("transitions the (tenantId, userId) membership to the given status", async () => {
      const returning = vi.fn().mockResolvedValue([{ ...membership, status: "active" }]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      const update = vi.fn().mockReturnValue({ set });
      const repo = new MembershipRepository({ update } as never);

      const result = await repo.updateStatusByTenantAndUser(
        "tenant-uuid-1",
        "user-uuid-1",
        "active",
      );

      expect(result).toBe(1);
    });

    it("returns 0 when no row matches the (tenantId, userId) pair", async () => {
      const returning = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      const update = vi.fn().mockReturnValue({ set });
      const repo = new MembershipRepository({ update } as never);

      const result = await repo.updateStatusByTenantAndUser("tenant-other", "user-uuid-1", "active");

      expect(result).toBe(0);
    });
  });

  describe("findActiveMemberships", () => {
    // 15a-v2-trainer-account-access Slice 3 (task 3.7): the minimal
    // active-tenant-selection primitive — returns EVERY active membership for
    // a user (not just the first), so a caller CAN choose among them. Not yet
    // wired into the default login path (see auth/tenant-selection.ts); the
    // client-facing tenant switch UI is deferred to S5.
    it("returns every active membership for the user", async () => {
      const other = { ...membership, id: "member-uuid-2", tenantId: "tenant-uuid-2" };
      const mockSelect = vi.fn().mockReturnValue(selectChain([membership, other]));
      const repo = new MembershipRepository({ select: mockSelect } as never);

      const result = await repo.findActiveMemberships("user-uuid-1");

      expect(result).toEqual([membership, other]);
    });

    it("returns an empty array when the user has no active memberships", async () => {
      const mockSelect = vi.fn().mockReturnValue(selectChain([]));
      const repo = new MembershipRepository({ select: mockSelect } as never);

      const result = await repo.findActiveMemberships("orphan");

      expect(result).toEqual([]);
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