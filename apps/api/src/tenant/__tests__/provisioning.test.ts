import { describe, it, expect, vi } from "vitest";
import { provisionTenantForUser, linkOauthToExistingUser } from "../provisioning.js";

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

  // --- 10a-user-memory-structured Slice 3: registration auto-provisioning ---
  // provisionTenantForUser MUST also insert a default user_profiles row inside
  // the SAME transaction, so a freshly-registered user always has a profile row
  // (name = email local part, goal/experienceLevel null). This removes the need
  // for GET /user-profile to lazy-provision on first read for registered users.

  it("inserts a default user_profiles row inside the transaction with the email local part as name", async () => {
    const capturedPayloads: unknown[] = [];
    const mockTx = {
      insert: vi.fn().mockImplementation((table: { _: unknown }) => ({
        values: vi.fn().mockImplementation((payload: unknown) => {
          capturedPayloads.push({ table, payload });
          return {
            returning: vi.fn().mockImplementation(() => {
              const n = capturedPayloads.length;
              if (n === 1) return Promise.resolve([{ id: "t-1" }]);
              if (n === 2) return Promise.resolve([{ id: "u-1" }]);
              if (n === 3) return Promise.resolve([{ id: "m-1" }]);
              // Billing/profile inserts carry no .returning() call — their values
              // chains are awaited directly. This branch is unreachable but kept
              // for shape symmetry with the shared mock.
              return Promise.resolve([]);
            }),
          };
        }),
      })),
    };

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

    // Exactly five inserts in order: tenants, users, memberships,
    // tenantBillingStates, userProfiles.
    expect(capturedPayloads).toHaveLength(5);
    const billingPayload = capturedPayloads[3]!.payload as Record<string, unknown>;
    expect(billingPayload).toMatchObject({
      tenantId: "t-1",
      tier: "pro",
      status: "trialing",
      source: "system",
    });
    expect(billingPayload.trialStartedAt).toBeInstanceOf(Date);
    expect(billingPayload.trialEndsAt).toBeInstanceOf(Date);
    expect(
      (billingPayload.trialEndsAt as Date).getTime() -
        (billingPayload.trialStartedAt as Date).getTime(),
    ).toBe(30 * 24 * 60 * 60 * 1000);
    const profilePayload = capturedPayloads[4]!.payload as Record<string, unknown>;
    expect(profilePayload).toMatchObject({
      userId: "u-1",
      name: "admin",
      goal: null,
      experienceLevel: null,
    });
  });

  it("falls back to 'user' when the email has no local part for the default profile name", async () => {
    const capturedPayloads: unknown[] = [];
    const mockTx = {
      insert: vi.fn().mockImplementation((table: { _: unknown }) => ({
        values: vi.fn().mockImplementation((payload: unknown) => {
          capturedPayloads.push({ table, payload });
          return {
            returning: vi.fn().mockImplementation(() => {
              const n = capturedPayloads.length;
              if (n === 1) return Promise.resolve([{ id: "t-1" }]);
              if (n === 2) return Promise.resolve([{ id: "u-1" }]);
              if (n === 3) return Promise.resolve([{ id: "m-1" }]);
              return Promise.resolve([]);
            }),
          };
        }),
      })),
    };

    const mockDb = {
      transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
    } as unknown as Parameters<typeof provisionTenantForUser>[0];

    await provisionTenantForUser(mockDb, {
      tenantName: "Acme Corp",
      userEmail: "@acme.com", // empty local part
    });

    const profilePayload = capturedPayloads[4]!.payload as Record<string, unknown>;
    expect(profilePayload.name).toBe("user");
  });

  it("writes the tenant trial row at the exact creation boundary without granting retroactive backfill semantics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T00:00:00.000Z"));

    const capturedPayloads: unknown[] = [];
    const mockTx = {
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((payload: unknown) => {
          capturedPayloads.push(payload);
          return {
            returning: vi.fn().mockImplementation(() => {
              const n = capturedPayloads.length;
              if (n === 1) return Promise.resolve([{ id: "t-1" }]);
              if (n === 2) return Promise.resolve([{ id: "u-1" }]);
              if (n === 3) return Promise.resolve([{ id: "m-1" }]);
              return Promise.resolve([]);
            }),
          };
        }),
      })),
    };

    const mockDb = {
      transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
    } as unknown as Parameters<typeof provisionTenantForUser>[0];

    await provisionTenantForUser(mockDb, {
      tenantName: "Acme Corp",
      userEmail: "admin@acme.com",
    });

    const billingPayload = capturedPayloads[3] as Record<string, unknown>;
    expect(billingPayload.source).toBe("system");
    expect(billingPayload.status).toBe("trialing");
    expect((billingPayload.trialStartedAt as Date).toISOString()).toBe(
      "2026-07-23T00:00:00.000Z",
    );
    expect((billingPayload.trialEndsAt as Date).toISOString()).toBe(
      "2026-08-22T00:00:00.000Z",
    );

    vi.useRealTimers();
  });

  it("provisions only ONE profile row per registration — the profile insert is part of the single provisioning transaction (no duplicate path)", async () => {
    // Registration calls provisionTenantForUser exactly once; the profile row
    // is the 4th insert in the SAME tx. A re-register of the same email fails
    // earlier on the users_email_unique constraint (covered by AuthService
    // register tests), so this row can never be duplicated at the source.
    const capturedPayloads: unknown[] = [];
    const mockTx = {
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((payload: unknown) => {
          capturedPayloads.push(payload);
          return {
            returning: vi.fn().mockImplementation(() => {
              const n = capturedPayloads.length;
              if (n === 1) return Promise.resolve([{ id: "t-9" }]);
              if (n === 2) return Promise.resolve([{ id: "u-9" }]);
              if (n === 3) return Promise.resolve([{ id: "m-9" }]);
              return Promise.resolve([]);
            }),
          };
        }),
      })),
    };

    const mockDb = {
      transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
    } as unknown as Parameters<typeof provisionTenantForUser>[0];

    await provisionTenantForUser(mockDb, {
      tenantName: "WS",
      userEmail: "solo@example.com",
    });

    // Exactly one of the five captured payloads is a userProfile-shaped row
    // ({ userId, name, goal, experienceLevel }) — the others are tenant/user/
    // membership/billing rows which do NOT carry `goal`/`experienceLevel`.
    const profileRows = capturedPayloads.filter(
      (p): p is Record<string, unknown> =>
        typeof p === "object" && p !== null && "goal" in p && "experienceLevel" in p
    );
    expect(profileRows).toHaveLength(1);
  });
});

// --- Scenario: OAuth account linking to an existing user (Spec Req: Google-only) ---
// linkOauthToExistingUser MUST NOT create a user or tenant — it only inserts the
// oauth_account row linked to an existing userId. Race-safety relies on the
// (provider_id, provider_account_id) + (provider_id, email) unique indexes.

describe("linkOauthToExistingUser", () => {
  it("inserts an oauth_account row linked to the existing userId and does not create a user/tenant", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockReturnValue({ values });

    const mockDb = { insert } as unknown as Parameters<
      typeof linkOauthToExistingUser
    >[0];

    await linkOauthToExistingUser(
      mockDb,
      "existing-user-1",
      "google",
      "google-acc-1",
      "owner@example.com"
    );

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
    // The values payload links the account to the existing user (a real Drizzle
    // query passes the table as insert target — assert the inserted payload shape).
    expect(values.mock.calls[0][0]).toMatchObject({
      providerId: "google",
      providerAccountId: "google-acc-1",
      email: "owner@example.com",
      userId: "existing-user-1",
    });
  });

  // Triangulation: a distinct identity links to a different existing user
  it("links a distinct OAuth identity to a second existing user without cross-contamination", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockReturnValue({ values });

    const mockDb = { insert } as unknown as Parameters<
      typeof linkOauthToExistingUser
    >[0];

    await linkOauthToExistingUser(
      mockDb,
      "existing-user-2",
      "google",
      "google-acc-2",
      "second@example.com"
    );

    expect(values.mock.calls[0][0]).toMatchObject({
      providerId: "google",
      providerAccountId: "google-acc-2",
      email: "second@example.com",
      userId: "existing-user-2",
    });
  });
});
