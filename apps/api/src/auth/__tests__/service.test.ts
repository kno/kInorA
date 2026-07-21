import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "../../db/client.js";

// provisionTenantForUser is mocked at module level so register tests
// can verify the orchestration without a live db transaction.
vi.mock("../../tenant/provisioning.js", () => ({
  provisionTenantForUser: vi.fn(),
}));

import { AuthService, AuthError, SESSION_TTL_MS } from "../service.js";
import { provisionTenantForUser } from "../../tenant/provisioning.js";
import { hashPassword } from "@kinora/domain";

const mockProvision = vi.mocked(provisionTenantForUser);

// --- Mock db helpers ----------------------------------------------------

/**
 * Build a thenable chain for db.insert(table).values(data):
 * `await db.insert(t).values(d)` resolves to undefined (no .returning()).
 * `db.insert(t).values(d).returning()` resolves to returnRows.
 */
function insertChain(returnRows: unknown[] = []) {
  const returning = vi.fn().mockResolvedValue(returnRows);
  const valuesResult: Record<string, unknown> = { returning };
  // Make valuesResult awaitable without .returning()
  valuesResult.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(undefined).then(resolve);
  return vi.fn().mockReturnValue(valuesResult);
}

function selectChain(rows: unknown[] = []) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function createMockDb(opts: {
  insertRows?: unknown[];
  userRows?: unknown[];
  credentialRows?: unknown[];
  membershipRows?: unknown[];
  tenantRows?: unknown[];
} = {}) {
  const insertValues = insertChain(opts.insertRows ?? []);

  return {
    select: vi
      .fn()
      .mockReturnValueOnce(selectChain(opts.userRows ?? []))
      .mockReturnValueOnce(selectChain(opts.credentialRows ?? []))
      .mockReturnValueOnce(selectChain(opts.membershipRows ?? []))
      .mockReturnValueOnce(selectChain(opts.tenantRows ?? [])),
    insert: vi.fn().mockReturnValue({ values: insertValues }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as Database;
}

// --- Tests ---------------------------------------------------------------

describe("AuthService.register", () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a tenant, credentials, and session for a new user", async () => {
    mockProvision.mockResolvedValue({
      tenantId: "tenant-uuid-1",
      userId: "user-uuid-1",
      membershipId: "member-uuid-1",
    });

    const sessionRow = {
      tokenHash: "hash-to-be-replaced",
      userId: "user-uuid-1",
      tenantId: "tenant-uuid-1",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    const db = createMockDb({ insertRows: [sessionRow] });
    service = new AuthService(db);

    const result = await service.register({
      email: "newuser@example.com",
      password: "SecurePass123!",
    });

    expect(result.token).toHaveLength(64);
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.user).toEqual({
      id: expect.any(String),
      email: "newuser@example.com",
    });
    expect(result.tenant).toEqual({
      id: expect.any(String),
      name: expect.any(String),
    });

    // Provisioning called with derived tenant name and user email
    expect(mockProvision).toHaveBeenCalledTimes(1);
    const provisionArgs = mockProvision.mock.calls[0];
    expect(provisionArgs[1]).toMatchObject({
      userEmail: "newuser@example.com",
    });

    // 2 insert calls: credentials + session
    expect((db as unknown as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledTimes(
      2
    );
  });

  // --- Triangle: edge cases ---

  it("rejects a duplicate email with an error", async () => {
    mockProvision.mockRejectedValue(
      new Error("unique constraint violation: users_email_unique")
    );

    const db = createMockDb();
    service = new AuthService(db);

    await expect(
      service.register({ email: "existing@example.com", password: "SecurePass123!" })
    ).rejects.toThrow();
  });

  it("rejects an invalid password (too short) before any db operation", async () => {
    const db = createMockDb();
    service = new AuthService(db);

    await expect(
      service.register({ email: "short@example.com", password: "12345" })
    ).rejects.toThrow(/password/i);

    // Provisioning should NOT have been called
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it("rejects an empty password", async () => {
    const db = createMockDb();
    service = new AuthService(db);

    await expect(
      service.register({ email: "nopass@example.com", password: "" })
    ).rejects.toThrow();

    expect(mockProvision).not.toHaveBeenCalled();
  });
});

// --- Login tests (task 1.2 + 4.2) ---

describe("AuthService.login", () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a session response for valid credentials", async () => {
    const realHash = hashPassword("SecurePass123!");
    const db = createMockDb({
      userRows: [{ id: "user-uuid-1", email: "user@example.com" }],
      credentialRows: [{ userId: "user-uuid-1", passwordHash: realHash }],
      membershipRows: [
        { id: "m-1", tenantId: "tenant-uuid-1", userId: "user-uuid-1", role: "owner", status: "active" },
      ],
      tenantRows: [{ id: "tenant-uuid-1", name: "user's workspace" }],
      insertRows: [
        {
          tokenHash: "hash",
          userId: "user-uuid-1",
          tenantId: "tenant-uuid-1",
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      ],
    });
    service = new AuthService(db);

    const result = await service.login({
      email: "user@example.com",
      password: "SecurePass123!",
    });

    expect(result.token).toHaveLength(64);
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.user).toEqual({ id: expect.any(String), email: "user@example.com" });
    expect(result.tenant).toEqual({ id: expect.any(String), name: "user's workspace" });
  });

  // --- Triangle: edge cases ---

  it("rejects login with a wrong password", async () => {
    const realHash = hashPassword("CorrectPass123!");
    const db = createMockDb({
      userRows: [{ id: "user-uuid-1", email: "user@example.com" }],
      credentialRows: [{ userId: "user-uuid-1", passwordHash: realHash }],
      membershipRows: [{ id: "m-1", tenantId: "t-1", userId: "user-uuid-1", role: "owner", status: "active" }],
      tenantRows: [{ id: "t-1", name: "ws" }],
    });
    service = new AuthService(db);

    await expect(
      service.login({ email: "user@example.com", password: "WrongPass456!" })
    ).rejects.toThrow();
  });

  it("rejects login with an unknown email", async () => {
    const db = createMockDb({
      userRows: [], // no user found
    });
    service = new AuthService(db);

    await expect(
      service.login({ email: "nobody@example.com", password: "AnyPassword123!" })
    ).rejects.toThrow();
  });

  it("rejects login for a social-only account with no password credentials", async () => {
    const db = createMockDb({
      userRows: [{ id: "social-uuid-1", email: "social@example.com" }],
      credentialRows: [], // no credentials (social-only)
    });
    service = new AuthService(db);

    await expect(
      service.login({ email: "social@example.com", password: "SomePassword123!" })
    ).rejects.toThrow();
  });

  it("rejects login for a suspended membership — no session issued", async () => {
    const realHash = hashPassword("SecurePass123!");
    // membershipRows is empty: the DB-level active-only filter excludes the suspended row.
    // tenantRows is present to ensure the only rejection reason is the missing active membership.
    const db = createMockDb({
      userRows: [{ id: "user-suspended", email: "suspended@example.com" }],
      credentialRows: [{ userId: "user-suspended", passwordHash: realHash }],
      membershipRows: [],
      tenantRows: [{ id: "t-1", name: "suspended workspace" }],
    });
    service = new AuthService(db);

    await expect(
      service.login({ email: "suspended@example.com", password: "SecurePass123!" })
    ).rejects.toThrow(AuthError);
  });

  it("rejects login for an invited membership — no session issued", async () => {
    const realHash = hashPassword("SecurePass123!");
    // membershipRows is empty: the DB-level active-only filter excludes the invited row.
    // tenantRows is present to ensure the only rejection reason is the missing active membership.
    const db = createMockDb({
      userRows: [{ id: "user-invited", email: "invited@example.com" }],
      credentialRows: [{ userId: "user-invited", passwordHash: realHash }],
      membershipRows: [],
      tenantRows: [{ id: "t-1", name: "invited workspace" }],
    });
    service = new AuthService(db);

    await expect(
      service.login({ email: "invited@example.com", password: "SecurePass123!" })
    ).rejects.toThrow(AuthError);
  });

  it("rejects login when user has no membership at all — no session issued", async () => {
    const realHash = hashPassword("SecurePass123!");
    const db = createMockDb({
      userRows: [{ id: "user-nomember", email: "nomember@example.com" }],
      credentialRows: [{ userId: "user-nomember", passwordHash: realHash }],
      membershipRows: [], // no membership of any kind
    });
    service = new AuthService(db);

    await expect(
      service.login({ email: "nomember@example.com", password: "SecurePass123!" })
    ).rejects.toThrow(AuthError);
  });
});

// --- Logout tests (task 1.3) ---

describe("AuthService.logout", () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a session by its token hash (sessionId)", async () => {
    const db = createMockDb();
    service = new AuthService(db);

    await service.logout("a".repeat(64));

    expect((db as unknown as { delete: ReturnType<typeof vi.fn> }).delete).toHaveBeenCalledTimes(1);
  });
});

describe("AuthService.getProfile", () => {
  it("returns the persisted display name from user_profiles when a profile row exists", async () => {
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(selectChain([{ id: "user-1", email: "alex@example.com" }]))
        .mockReturnValueOnce(selectChain([{ userId: "user-1", name: "Alex Rivera" }])),
    } as unknown as Database;
    const service = new AuthService(db);

    const result = await service.getProfile("user-1");

    expect(result).toEqual({
      email: "alex@example.com",
      initials: "A",
      name: "Alex Rivera",
    });
  });

  it("falls back to the email-local-part initial when no user_profiles row exists", async () => {
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(selectChain([{ id: "user-1", email: "bianca@example.com" }]))
        .mockReturnValueOnce(selectChain([])),
    } as unknown as Database;
    const service = new AuthService(db);

    const result = await service.getProfile("user-1");

    expect(result).toEqual({
      email: "bianca@example.com",
      initials: "B",
      name: "bianca@example.com",
    });
  });
});
