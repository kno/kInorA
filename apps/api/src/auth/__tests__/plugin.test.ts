import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin, requireAuth, resolveAuthContextFromToken } from "../plugin.js";
import type { Database } from "../../db/client.js";

// --- Mock helpers -------------------------------------------------------

function selectChain(rows: unknown[] = []) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

const ACTIVE_MEMBERSHIP = {
  id: "membership-uuid-1",
  tenantId: "tenant-uuid-1",
  userId: "user-uuid-1",
  role: "member" as const,
  status: "active" as const,
  createdAt: new Date(),
};

/**
 * Mock DB whose `select()` returns, in order:
 *   1st call → session rows (SessionRepository.findByTokenHash)
 *   2nd call → membership rows (MembershipRepository.findByTenantAndUser)
 *
 * A default active membership is supplied so that a valid session resolves
 * to a non-null authContext unless a test overrides `membershipRows`.
 */
function createMockDb(opts: {
  sessionRows?: unknown[];
  membershipRows?: unknown[];
} = {}) {
  return {
    select: vi
      .fn()
      .mockReturnValueOnce(selectChain(opts.sessionRows ?? []))
      .mockReturnValueOnce(
        selectChain(opts.membershipRows ?? [ACTIVE_MEMBERSHIP])
      ),
  } as unknown as Database;
}

/**
 * Tenant-aware mock DB. The membership select resolves the row for the SESSION's
 * tenant (captured from the session row), faithfully modelling the tenant-scoped
 * `findByTenantAndUser` lookup. This is what makes the multi-tenant scenario
 * representable: a user active in one tenant and suspended in another gets the
 * status of the tenant their session is scoped to — not a nondeterministic row.
 */
function createTenantAwareMockDb(opts: {
  sessionRows: Array<{ tenantId: string; userId: string; [k: string]: unknown }>;
  membershipsByTenant: Record<
    string,
    { status: "invited" | "active" | "suspended" } & Record<string, unknown>
  >;
}) {
  let sessionTenantId: string | undefined;
  let call = 0;

  const select = vi.fn().mockImplementation(() => {
    const isSessionCall = call === 0;
    call++;
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(async () => {
          if (isSessionCall) {
            const session = opts.sessionRows[0];
            sessionTenantId = session?.tenantId;
            return opts.sessionRows;
          }
          // Membership select — tenant-scoped: only the session tenant's row.
          const row =
            sessionTenantId !== undefined
              ? opts.membershipsByTenant[sessionTenantId]
              : undefined;
          return row ? [row] : [];
        }),
      }),
    };
  });

  return { select } as unknown as Database;
}

// --- Tests ---------------------------------------------------------------

describe("auth plugin session extraction", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  it("sets request.authContext from a valid bearer token", async () => {
    const sessionRow = {
      tokenHash: "a".repeat(64),
      userId: "user-uuid-1",
      tenantId: "tenant-uuid-1",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    const db = createMockDb({ sessionRows: [sessionRow] });

    app = Fastify();
    await app.register(authPlugin, { db });
    app.get("/test", async (request) => ({
      authContext: request.authContext,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/test",
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.authContext).not.toBeNull();
    expect(body.authContext.userId).toBeDefined();
    expect(body.authContext.tenantId).toBeDefined();
    expect(body.authContext.sessionId).toBeDefined();
  });

  // --- Triangle: edge cases ---

  it("sets request.authContext to null when the Authorization header is missing", async () => {
    const db = createMockDb();

    app = Fastify();
    await app.register(authPlugin, { db });
    app.get("/test", async (request) => ({
      authContext: request.authContext,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/test",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.authContext).toBeNull();
  });

  it("sets request.authContext to null when the bearer token is malformed", async () => {
    const db = createMockDb();

    app = Fastify();
    await app.register(authPlugin, { db });
    app.get("/test", async (request) => ({
      authContext: request.authContext,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/test",
      headers: { authorization: "Bearer not-a-valid-token" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.authContext).toBeNull();
  });

  it("sets request.authContext to null when the session is expired", async () => {
    const expiredSession = {
      tokenHash: "a".repeat(64),
      userId: "user-uuid-1",
      tenantId: "tenant-uuid-1",
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 30 * 1000), // expired 30s ago
    };
    const db = createMockDb({ sessionRows: [expiredSession] });

    app = Fastify();
    await app.register(authPlugin, { db });
    app.get("/test", async (request) => ({
      authContext: request.authContext,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/test",
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.authContext).toBeNull();
  });
});

describe("requireAuth preHandler + 401 enforcement", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  // Spec: "Missing session rejected" — protected endpoint, no valid session → 401
  it("returns 401 with { error: 'unauthorized' } when no auth is provided", async () => {
    const db = createMockDb();

    app = Fastify();
    await app.register(authPlugin, { db });
    app.addHook("preHandler", requireAuth());
    app.get("/protected", async (request) => ({
      authContext: request.authContext,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  // Spec: valid session → handler runs, request passes through
  it("passes through to the handler when a valid token is provided", async () => {
    const sessionRow = {
      tokenHash: "a".repeat(64),
      userId: "user-uuid-1",
      tenantId: "tenant-uuid-1",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    const db = createMockDb({ sessionRows: [sessionRow] });

    app = Fastify();
    await app.register(authPlugin, { db });
    app.addHook("preHandler", requireAuth());
    app.get("/protected", async () => ({
      ok: true,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(response.headers["x-auth-error"]).toBeUndefined();
  });

  // Triangle: onSend observability — x-auth-error header still set on 401
  it("still sets x-auth-error header on 401 responses for observability", async () => {
    const db = createMockDb();

    app = Fastify();
    await app.register(authPlugin, { db });
    app.addHook("preHandler", requireAuth());
    app.get("/protected", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["x-auth-error"]).toBe("missing_session");
  });

  // Triangle: expired token → authContext null → 401
  it("returns 401 when the token is expired", async () => {
    const expiredSession = {
      tokenHash: "a".repeat(64),
      userId: "user-uuid-1",
      tenantId: "tenant-uuid-1",
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 30 * 1000), // expired 30s ago
    };
    const db = createMockDb({ sessionRows: [expiredSession] });

    app = Fastify();
    await app.register(authPlugin, { db });
    app.addHook("preHandler", requireAuth());
    app.get("/protected", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });
});

describe("membership status re-check (fail-secure)", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  const validSession = {
    tokenHash: "a".repeat(64),
    userId: "user-uuid-1",
    tenantId: "tenant-uuid-1",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };

  // Problem 2: a user suspended AFTER their session was issued must lose access
  // immediately, not at token expiry. onRequest re-checks membership.status.
  it("sets authContext to null when the membership is suspended", async () => {
    const db = createMockDb({
      sessionRows: [validSession],
      membershipRows: [
        { ...ACTIVE_MEMBERSHIP, status: "suspended" },
      ],
    });

    app = Fastify();
    await app.register(authPlugin, { db });
    app.get("/test", async (request) => ({
      authContext: request.authContext,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/test",
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toBeNull();
  });

  // Fail-secure: no membership row at all → deny.
  it("sets authContext to null when the user has no membership", async () => {
    const db = createMockDb({
      sessionRows: [validSession],
      membershipRows: [],
    });

    app = Fastify();
    await app.register(authPlugin, { db });
    app.get("/test", async (request) => ({
      authContext: request.authContext,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/test",
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toBeNull();
  });

  // Fail-secure: an "invited" (not yet accepted) membership is not active.
  it("sets authContext to null when the membership is only invited", async () => {
    const db = createMockDb({
      sessionRows: [validSession],
      membershipRows: [{ ...ACTIVE_MEMBERSHIP, status: "invited" }],
    });

    app = Fastify();
    await app.register(authPlugin, { db });
    app.get("/test", async (request) => ({
      authContext: request.authContext,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/test",
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toBeNull();
  });

  // A suspended membership behind requireAuth() → 401, not silent pass-through.
  it("returns 401 on a protected route when the membership is suspended", async () => {
    const db = createMockDb({
      sessionRows: [validSession],
      membershipRows: [{ ...ACTIVE_MEMBERSHIP, status: "suspended" }],
    });

    app = Fastify();
    await app.register(authPlugin, { db });
    app.addHook("preHandler", requireAuth());
    app.get("/protected", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  // Active membership still passes through — the happy path is unchanged.
  it("keeps authContext for an active membership", async () => {
    const db = createMockDb({
      sessionRows: [validSession],
      membershipRows: [ACTIVE_MEMBERSHIP],
    });

    app = Fastify();
    await app.register(authPlugin, { db });
    app.addHook("preHandler", requireAuth());
    app.get("/protected", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
  });

  // Drive invited/no-membership end-to-end through a protected route → HTTP 401,
  // not just authContext-null on an open route.
  it("returns 401 on a protected route when the membership is only invited", async () => {
    const db = createMockDb({
      sessionRows: [validSession],
      membershipRows: [{ ...ACTIVE_MEMBERSHIP, status: "invited" }],
    });

    app = Fastify();
    await app.register(authPlugin, { db });
    app.addHook("preHandler", requireAuth());
    app.get("/protected", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 on a protected route when the user has no membership", async () => {
    const db = createMockDb({
      sessionRows: [validSession],
      membershipRows: [],
    });

    app = Fastify();
    await app.register(authPlugin, { db });
    app.addHook("preHandler", requireAuth());
    app.get("/protected", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });
});

describe("membership re-check is TENANT-SCOPED (multi-tenant user)", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  const TENANT_A = "tenant-a-uuid";
  const TENANT_B = "tenant-b-uuid";
  const USER = "multi-tenant-user-uuid";

  // The user is ACTIVE in tenant A but SUSPENDED in tenant B.
  const membershipsByTenant = {
    [TENANT_A]: {
      id: "m-a",
      tenantId: TENANT_A,
      userId: USER,
      role: "member" as const,
      status: "active" as const,
      createdAt: new Date(),
    },
    [TENANT_B]: {
      id: "m-b",
      tenantId: TENANT_B,
      userId: USER,
      role: "member" as const,
      status: "suspended" as const,
      createdAt: new Date(),
    },
  };

  function sessionForTenant(tenantId: string) {
    return {
      tokenHash: "a".repeat(64),
      userId: USER,
      tenantId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  }

  // BLOCKER regression: a tenant-B session (user suspended in B) must be DENIED,
  // even though the SAME user is active in tenant A. A by-user-only lookup could
  // return tenant A's active row and wrongly authenticate the suspended session.
  it("denies (401) a session scoped to a tenant where the user is suspended", async () => {
    const db = createTenantAwareMockDb({
      sessionRows: [sessionForTenant(TENANT_B)],
      membershipsByTenant,
    });

    app = Fastify();
    await app.register(authPlugin, { db });
    app.addHook("preHandler", requireAuth());
    app.get("/protected", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  // The same user's tenant-A session (where they ARE active) is allowed.
  it("allows a session scoped to a tenant where the user is active", async () => {
    const db = createTenantAwareMockDb({
      sessionRows: [sessionForTenant(TENANT_A)],
      membershipsByTenant,
    });

    app = Fastify();
    await app.register(authPlugin, { db });
    app.addHook("preHandler", requireAuth());
    app.get("/protected", async (request) => ({
      ok: true,
      tenantId: request.authContext!.tenantId,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${"a".repeat(64)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, tenantId: TENANT_A });
  });
});

describe("membership re-check uses findByTenantAndUser with the session tenant", () => {
  // Unit-level: drive resolveAuthContextFromToken with an explicit repo mock so
  // we assert the EXACT tenant-scoped call — a by-user-only lookup would not
  // satisfy these expectations.
  const VALID_TOKEN = "a".repeat(64);

  function sessionRepo(row: unknown) {
    return { findByTokenHash: vi.fn().mockResolvedValue(row) };
  }

  const session = {
    tokenHash: VALID_TOKEN,
    userId: "user-x",
    tenantId: "tenant-scoped-1",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };

  it("passes the session's tenantId and userId to findByTenantAndUser", async () => {
    const membershipRepo = {
      findByTenantAndUser: vi.fn().mockResolvedValue({
        status: "active",
      }),
    };

    const ctx = await resolveAuthContextFromToken(VALID_TOKEN, {
      sessionRepo: sessionRepo(session),
      membershipRepo,
    });

    expect(membershipRepo.findByTenantAndUser).toHaveBeenCalledTimes(1);
    expect(membershipRepo.findByTenantAndUser).toHaveBeenCalledWith(
      "tenant-scoped-1",
      "user-x"
    );
    expect(ctx).not.toBeNull();
  });

  // Fail-secure: a repository error must NOT grant access. The rejection
  // propagates so the request pipeline denies — never fail-open.
  it("fails secure (rejects, no context granted) when the membership lookup errors", async () => {
    const membershipRepo = {
      findByTenantAndUser: vi
        .fn()
        .mockRejectedValue(new Error("db unavailable")),
    };

    await expect(
      resolveAuthContextFromToken(VALID_TOKEN, {
        sessionRepo: sessionRepo(session),
        membershipRepo,
      })
    ).rejects.toThrow("db unavailable");
  });

  // No membershipRepo provided → check skipped (public/extraction paths).
  it("skips the re-check when no membershipRepo is provided", async () => {
    const ctx = await resolveAuthContextFromToken(VALID_TOKEN, {
      sessionRepo: sessionRepo(session),
    });

    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe("tenant-scoped-1");
  });
});

describe("requireAuth footgun — no code runs after an unauthorized send", () => {
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    app = undefined;
  });

  afterEach(async () => {
    // Some tests drive the guard directly and never build an app.
    await app?.close();
  });

  // Problem 1: requireAuth() must short-circuit after sending 401 so that no
  // code after `sendUnauthorized` runs on an already-sent reply. We drive the
  // guard directly with a spy reply and assert it (a) sends exactly once and
  // (b) returns undefined (the explicit `return` / short-circuit), which is the
  // signal that guarantees follow-up statements are unreachable.
  it("sends the 401 exactly once and returns after the unauthorized send", async () => {
    const guard = requireAuth();

    const request = { authContext: null } as unknown as import("fastify").FastifyRequest;
    const send = vi.fn().mockReturnThis();
    const code = vi.fn().mockReturnThis();
    const reply = { code, send } as unknown as import("fastify").FastifyReply;

    const result = await guard(request, reply);

    // The guard must have terminated the request lifecycle itself.
    expect(code).toHaveBeenCalledTimes(1);
    expect(code).toHaveBeenCalledWith(401);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ error: "unauthorized" });
    // A returned reply (or undefined) — never falling through to extra logic.
    expect(result === undefined || result === reply).toBe(true);
  });

  // Integration: through Fastify, an unauthenticated protected request yields a
  // clean single 401 with the observability header and no double-send error.
  it("produces a clean single 401 through the full lifecycle", async () => {
    const db = createMockDb();

    app = Fastify();
    await app.register(authPlugin, { db });
    app.addHook("preHandler", requireAuth());
    app.get("/protected", async () => ({ ok: true }));

    const response = await app.inject({ method: "GET", url: "/protected" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
    expect(response.headers["x-auth-error"]).toBe("missing_session");
  });
});