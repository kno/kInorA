import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "../../db/client.js";

// provisionTenantForUser is mocked at module level so register tests
// can verify the orchestration without a live db transaction.
vi.mock("../../tenant/provisioning.js", () => ({
  provisionTenantForUser: vi.fn(),
}));

import { AuthService } from "../service.js";
import { provisionTenantForUser } from "../../tenant/provisioning.js";

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