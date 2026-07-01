/**
 * Tests for the authenticated WebSocket plan-status route:
 *   GET /ws/plans  (WebSocket upgrade)
 *
 * Auth paths tested:
 *   1. Authorization: Bearer <token> header (existing clients, test harness)
 *   2. ?token=<token> query param (browser WebSocket — browsers cannot send custom headers)
 *   3. Neither header nor query param → 401
 *
 * Strategy:
 * - Use app.injectWS(...) from @fastify/websocket to test the WS upgrade path
 * - For exact 401 status: use app.inject() with Upgrade headers (HTTP-level assertion)
 * - Mock the session DB so authenticated and unauthenticated paths can be exercised
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { authPlugin } from "../../auth/plugin.js";
import { wsRoutes } from "../ws.js";
import { WsRegistry } from "../../ws/registry.js";
import type { Database } from "../../db/client.js";

// --- Fixtures ---

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";

const VALID_TOKEN = "a".repeat(64);
const SESSION_HASH = "b".repeat(64);

// --- Helpers ---

function buildSessionRow(tenantId = TENANT_A, userId = USER_A) {
  return {
    tokenHash: SESSION_HASH,
    userId,
    tenantId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
  };
}

// Explicit active-membership row for the tenant-scoped re-check
// (MembershipRepository.findByTenantAndUser). Kept DISTINCT from the session row
// so the membership query is represented as its own result, not blended.
function buildActiveMembershipRow(tenantId = TENANT_A, userId = USER_A) {
  return {
    id: "membership-uuid-1",
    tenantId,
    userId,
    role: "owner" as const,
    status: "active" as const,
    createdAt: new Date(),
  };
}

/**
 * Build a mock DB for the WS auth flow. Every authenticated WS request performs
 * exactly two ordered selects — session lookup then tenant-scoped membership
 * re-check — via either the Bearer onRequest hook or the ?token= preValidation
 * path (never interleaved). The mock therefore alternates results pairwise:
 * odd-indexed call (0,2,4,...) → session rows, even-indexed (1,3,5,...) →
 * membership rows. Passing a null session yields the unauthenticated case.
 */
function buildSessionDb(
  sessionRow?: unknown,
  membershipRow: unknown = buildActiveMembershipRow()
): Database {
  const sessionRows = sessionRow ? [sessionRow] : [];
  // Membership is only meaningful when there is a session to authenticate.
  const membershipRows = sessionRow ? [membershipRow] : [];
  let call = 0;
  const selectMock = vi.fn().mockImplementation(() => {
    const isSessionCall = call % 2 === 0;
    call++;
    const rows = isSessionCall ? sessionRows : membershipRows;
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    };
  });
  return { select: selectMock } as unknown as Database;
}

async function buildTestApp(opts: {
  db: Database;
  registry?: WsRegistry;
}): Promise<FastifyInstance> {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error.validation) {
      return reply.code(422).send({ error: "Validation Error" });
    }
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(statusCode).send({ error: error.message ?? "Internal Server Error" });
  });

  await app.register(authPlugin, { db: opts.db });
  await app.register(fastifyWebsocket);
  // Pass db so wsRoutes can resolve ?token= query-param auth via the shared
  // resolveAuthContextFromToken (same SessionRepository as the Bearer path).
  await app.register(wsRoutes, { registry: opts.registry ?? new WsRegistry(), db: opts.db });

  return app;
}

// --- Tests ---

describe("WS route — GET /ws/plans", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // Fix 3: assert exact 401 for unauthenticated (via HTTP-level inject)
  // -------------------------------------------------------------------------
  describe("unauthenticated connection — exact 401", () => {
    it("returns HTTP 401 when no token is provided (HTTP-level assertion)", async () => {
      const db = buildSessionDb(); // no session row → authContext = null
      app = await buildTestApp({ db });
      await app.ready();

      // Use app.inject() with Upgrade headers to get a real HTTP response before
      // the 101 handshake. This lets us assert statusCode === 401 directly.
      const response = await app.inject({
        method: "GET",
        url: "/ws/plans",
        headers: {
          connection: "upgrade",
          upgrade: "websocket",
          "sec-websocket-key": Buffer.from("test-key-12345678901").toString("base64"),
          "sec-websocket-version": "13",
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    });

    it("rejects injectWS with a non-101 error when no auth token is provided", async () => {
      const db = buildSessionDb(); // no session row
      app = await buildTestApp({ db });
      await app.ready();

      await expect(
        app.injectWS("/ws/plans")
      ).rejects.toThrow(/server response/i);
    });
  });

  // -------------------------------------------------------------------------
  // Fix 1: Bearer-header auth path (existing — must still work)
  // -------------------------------------------------------------------------
  describe("authenticated connection — Bearer header", () => {
    it("accepts the WS upgrade when a valid bearer token is provided", async () => {
      const db = buildSessionDb(buildSessionRow());
      app = await buildTestApp({ db });
      await app.ready();

      // injectWS resolving proves the upgrade was accepted (non-101 throws).
      const ws = await app.injectWS("/ws/plans", {
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(ws).toBeDefined();
      await new Promise<void>((resolve) => {
        if ((ws as unknown as { readyState: number }).readyState === 1) {
          resolve();
        } else {
          ws.on("open", resolve);
          ws.on("error", resolve);
          setTimeout(resolve, 1000);
        }
      });
      ws.close();
      await new Promise<void>((resolve) => {
        ws.on("close", resolve);
        setTimeout(resolve, 500);
      });
    });

    it("registers the socket in the WsRegistry under the correct userId", async () => {
      const db = buildSessionDb(buildSessionRow());
      const registry = new WsRegistry();
      const registerSpy = vi.spyOn(registry, "register");
      app = await buildTestApp({ db, registry });
      await app.ready();

      const ws = await app.injectWS("/ws/plans", {
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      await new Promise<void>((resolve) => {
        ws.on("open", () => {
          ws.close();
          resolve();
        });
        ws.on("error", resolve);
        setTimeout(resolve, 1000);
      });

      expect(registerSpy).toHaveBeenCalledWith(USER_A, expect.anything());
    });
  });

  // -------------------------------------------------------------------------
  // Fix 1: query-param auth path (browser WebSocket — no Authorization header)
  // -------------------------------------------------------------------------
  describe("authenticated connection — ?token= query param (browser WebSocket path)", () => {
    it("accepts the WS upgrade when a valid ?token= query param is provided (no Authorization header)", async () => {
      const db = buildSessionDb(buildSessionRow());
      app = await buildTestApp({ db });
      await app.ready();

      // Browser-style: no Authorization header, token in query string
      const ws = await app.injectWS(`/ws/plans?token=${VALID_TOKEN}`);

      expect(ws).toBeDefined();
      await new Promise<void>((resolve) => {
        if ((ws as unknown as { readyState: number }).readyState === 1) {
          resolve();
        } else {
          ws.on("open", resolve);
          ws.on("error", resolve);
          setTimeout(resolve, 1000);
        }
      });
      ws.close();
      await new Promise<void>((resolve) => {
        ws.on("close", resolve);
        setTimeout(resolve, 500);
      });
    });

    it("registers the socket under the correct userId when authenticated via ?token=", async () => {
      const db = buildSessionDb(buildSessionRow());
      const registry = new WsRegistry();
      const registerSpy = vi.spyOn(registry, "register");
      app = await buildTestApp({ db, registry });
      await app.ready();

      const ws = await app.injectWS(`/ws/plans?token=${VALID_TOKEN}`);

      await new Promise<void>((resolve) => {
        ws.on("open", () => {
          ws.close();
          resolve();
        });
        ws.on("error", resolve);
        setTimeout(resolve, 1000);
      });

      // Must be registered under USER_A's userId (same as Bearer path)
      expect(registerSpy).toHaveBeenCalledWith(USER_A, expect.anything());
    });

    it("returns HTTP 401 when ?token= is invalid/expired (HTTP-level assertion)", async () => {
      const db = buildSessionDb(); // no session → resolves null
      app = await buildTestApp({ db });
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: `/ws/plans?token=${"z".repeat(64)}`,
        headers: {
          connection: "upgrade",
          upgrade: "websocket",
          "sec-websocket-key": Buffer.from("test-key-12345678901").toString("base64"),
          "sec-websocket-version": "13",
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("rejects injectWS when ?token= is invalid (no session found)", async () => {
      const db = buildSessionDb(); // no session row
      app = await buildTestApp({ db });
      await app.ready();

      await expect(
        app.injectWS(`/ws/plans?token=${"z".repeat(64)}`)
      ).rejects.toThrow(/server response/i);
    });
  });

  // -------------------------------------------------------------------------
  // WsRegistry.notify payload shape
  // -------------------------------------------------------------------------
  describe("WsRegistry.notify payload shape", () => {
    it("socket receives { planId, status } when registry.notify is called for the user", async () => {
      const db = buildSessionDb(buildSessionRow());
      const registry = new WsRegistry();
      app = await buildTestApp({ db, registry });
      await app.ready();

      const ws = await app.injectWS("/ws/plans", {
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      const receivedMessages: string[] = [];
      ws.on("message", (data: Buffer) => {
        receivedMessages.push(data.toString());
      });

      await new Promise<void>((resolve) => {
        ws.on("open", resolve);
        setTimeout(resolve, 1000);
      });

      const payload = { planId: "plan-abc-123", status: "ready" as const };
      registry.notify(USER_A, payload);

      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      ws.close();
      await new Promise<void>((resolve) => {
        ws.on("close", resolve);
        setTimeout(resolve, 500);
      });

      expect(receivedMessages).toHaveLength(1);
      const received = JSON.parse(receivedMessages[0]) as typeof payload;
      expect(received.planId).toBe("plan-abc-123");
      expect(received.status).toBe("ready");
    });

    it("socket receives correct payload for 'failed' status", async () => {
      const db = buildSessionDb(buildSessionRow());
      const registry = new WsRegistry();
      app = await buildTestApp({ db, registry });
      await app.ready();

      const ws = await app.injectWS("/ws/plans", {
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      const receivedMessages: string[] = [];
      ws.on("message", (data: Buffer) => {
        receivedMessages.push(data.toString());
      });

      await new Promise<void>((resolve) => {
        ws.on("open", resolve);
        setTimeout(resolve, 1000);
      });

      registry.notify(USER_A, { planId: "plan-xyz-456", status: "failed" });

      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      ws.close();
      await new Promise<void>((resolve) => {
        ws.on("close", resolve);
        setTimeout(resolve, 500);
      });

      expect(receivedMessages).toHaveLength(1);
      const received = JSON.parse(receivedMessages[0]) as { planId: string; status: string };
      expect(received.planId).toBe("plan-xyz-456");
      expect(received.status).toBe("failed");
    });
  });
});
