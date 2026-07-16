import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { AuthService, SESSION_TTL_MS } from "../../auth/service.js";
import { authPlugin } from "../../auth/plugin.js";
import { computeTokenHash } from "../../auth/session.js";
import { authRoutes } from "../auth.js";
import type { Database } from "../../db/client.js";
import { hashPassword } from "@kinora/domain";

// provisionTenantForUser mocked at module level
vi.mock("../../tenant/provisioning.js", () => ({
  provisionTenantForUser: vi.fn(),
}));

import { provisionTenantForUser } from "../../tenant/provisioning.js";

const mockProvision = vi.mocked(provisionTenantForUser);

// --- Mock helpers ----------------------------------------------------

function selectChain(rows: unknown[] = []) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function insertChain(returnRows: unknown[] = []) {
  const returning = vi.fn().mockResolvedValue(returnRows);
  const valuesResult: Record<string, unknown> = { returning };
  valuesResult.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(undefined).then(resolve);
  return vi.fn().mockReturnValue(valuesResult);
}

function createMockDb(opts: {
  insertRows?: unknown[];
  userRows?: unknown[];
  credentialRows?: unknown[];
  membershipRows?: unknown[];
  tenantRows?: unknown[];
  sessionRows?: unknown[];
} = {}) {
  return {
    select: vi
      .fn()
      .mockReturnValueOnce(selectChain(opts.userRows ?? []))
      .mockReturnValueOnce(selectChain(opts.credentialRows ?? []))
      .mockReturnValueOnce(selectChain(opts.membershipRows ?? []))
      .mockReturnValueOnce(selectChain(opts.tenantRows ?? []))
      .mockReturnValueOnce(selectChain(opts.sessionRows ?? [])),
    insert: vi.fn().mockReturnValue({ values: insertChain(opts.insertRows ?? []) }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as Database;
}

// Each test builds its own app via buildApp so the DB is wired in.
// We replicate the registration order used by index.ts.
async function buildTestApp(db: Database) {
  const app = Fastify();
  const authService = new AuthService(db);

  // Error handler must be set BEFORE registering route plugins so
  // child scopes inherit it.
  app.setErrorHandler((error, _request, reply) => {
    if (error.validation) {
      return reply.code(422).send({
        error: "Validation Error",
        details: error.validation,
      });
    }
    // AuthError → 401
    if (error.name === "AuthError") {
      return reply.code(401).send({ error: error.message });
    }
    return reply.code(500).send({ error: "Internal Server Error" });
  });

  await app.register(authPlugin, { db });
  app.decorate("authService", authService);
  await app.register(authRoutes, { authService });

  return app;
}

// --- Tests ------------------------------------------------------------

describe("Auth routes integration", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe("POST /auth/register", () => {
    it("returns 200 with SessionResponse + token for valid input", async () => {
      mockProvision.mockResolvedValue({
        tenantId: "tenant-uuid-1",
        userId: "user-uuid-1",
        membershipId: "member-uuid-1",
      });

      const sessionRow = {
        tokenHash: "hash",
        userId: "user-uuid-1",
        tenantId: "tenant-uuid-1",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      };
      const db = createMockDb({ insertRows: [sessionRow] });
      app = await buildTestApp(db);

      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email: "newuser@example.com", password: "SecurePass123!" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.token).toHaveLength(64);
      expect(body.token).toMatch(/^[0-9a-f]{64}$/);
      expect(body.user).toEqual({ id: expect.any(String), email: "newuser@example.com" });
      expect(body.tenant).toEqual({ id: expect.any(String), name: expect.any(String) });
    });

    it("returns 422 when email is missing", async () => {
      const db = createMockDb();
      app = await buildTestApp(db);

      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { password: "SecurePass123!" },
      });

      expect(response.statusCode).toBe(422);
    });

    it("returns 422 when password is missing", async () => {
      const db = createMockDb();
      app = await buildTestApp(db);

      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email: "test@example.com" },
      });

      expect(response.statusCode).toBe(422);
    });

    it("returns 422 when both fields are missing (empty body)", async () => {
      const db = createMockDb();
      app = await buildTestApp(db);

      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {},
      });

      expect(response.statusCode).toBe(422);
    });
  });

  describe("POST /auth/login", () => {
    it("returns 200 with SessionResponse for valid credentials", async () => {
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
      app = await buildTestApp(db);

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "user@example.com", password: "SecurePass123!" },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.token).toHaveLength(64);
      expect(body.user.email).toBe("user@example.com");
      expect(body.tenant.name).toBe("user's workspace");
    });

    it("returns 422 when email is missing", async () => {
      const db = createMockDb();
      app = await buildTestApp(db);

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { password: "SecurePass123!" },
      });

      expect(response.statusCode).toBe(422);
    });

    it("returns 401 for wrong password", async () => {
      const realHash = hashPassword("CorrectPass123!");
      const db = createMockDb({
        userRows: [{ id: "u-1", email: "user@example.com" }],
        credentialRows: [{ userId: "u-1", passwordHash: realHash }],
      });
      app = await buildTestApp(db);

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "user@example.com", password: "WrongPass456!" },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /auth/identity (Phase 4 web offline — stable identity key derivation)", () => {
    /**
     * The web offline module needs a STABLE, server-resolved identity to
     * scope its client-side IndexedDB store (design: identity key derived
     * from `(tenantId, userId)`, not the session token — which rotates
     * every login). The web Server Action has no direct DB access, so it
     * resolves `(tenantId, userId)` via this authenticated endpoint before
     * hashing them into the opaque identity key.
     */
    function buildIdentityDb(opts: {
      sessionRow?: unknown;
      membershipRow?: unknown;
    }) {
      const sessionRows = opts.sessionRow ? [opts.sessionRow] : [];
      const membershipRows = opts.membershipRow ? [opts.membershipRow] : [];
      return {
        select: vi
          .fn()
          .mockReturnValueOnce(selectChain(sessionRows))
          .mockReturnValueOnce(selectChain(membershipRows)),
      } as unknown as Database;
    }

    it("returns the tenantId + userId from the resolved auth context for a valid Bearer token", async () => {
      const rawToken = "a".repeat(64);
      const db = buildIdentityDb({
        sessionRow: {
          tokenHash: computeTokenHash(rawToken),
          userId: "user-uuid-1",
          tenantId: "tenant-uuid-1",
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
        membershipRow: {
          id: "m-1",
          tenantId: "tenant-uuid-1",
          userId: "user-uuid-1",
          role: "owner",
          status: "active",
        },
      });
      app = await buildTestApp(db);

      const response = await app.inject({
        method: "GET",
        url: "/auth/identity",
        headers: { authorization: `Bearer ${rawToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        tenantId: "tenant-uuid-1",
        userId: "user-uuid-1",
      });
    });

    it("returns 401 when there is no Bearer token", async () => {
      const db = buildIdentityDb({});
      app = await buildTestApp(db);

      const response = await app.inject({ method: "GET", url: "/auth/identity" });

      expect(response.statusCode).toBe(401);
    });

    it("returns 401 for an unknown/expired session token", async () => {
      const db = buildIdentityDb({});
      app = await buildTestApp(db);

      const response = await app.inject({
        method: "GET",
        url: "/auth/identity",
        headers: { authorization: `Bearer ${"a".repeat(64)}` },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});