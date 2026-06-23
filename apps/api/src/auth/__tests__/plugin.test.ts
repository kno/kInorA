import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin, requireAuth } from "../plugin.js";
import type { Database } from "../../db/client.js";

// --- Mock helpers -------------------------------------------------------

function selectChain(rows: unknown[] = []) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function createMockDb(opts: { sessionRows?: unknown[] } = {}) {
  return {
    select: vi.fn().mockReturnValueOnce(selectChain(opts.sessionRows ?? [])),
  } as unknown as Database;
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