/**
 * Tests for the authenticated WebSocket plan-status route:
 *   GET /ws/plans  (WebSocket upgrade)
 *
 * Strategy:
 * - Use app.injectWS(...) from @fastify/websocket to test the WS upgrade path
 * - Mock the session DB so authenticated and unauthenticated paths can be exercised
 * - Test: authenticated connection accepted; unauthenticated rejected
 * - Test: WsRegistry.notify sends the correct { planId, status } payload shape
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

function buildSessionDb(sessionRow?: unknown): Database {
  const rows = sessionRow ? [sessionRow] : [];
  const selectMock = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
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
  await app.register(wsRoutes, { registry: opts.registry ?? new WsRegistry() });

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

  describe("authenticated connection", () => {
    it("accepts the WS upgrade when a valid bearer token is provided", async () => {
      const db = buildSessionDb(buildSessionRow());
      app = await buildTestApp({ db });
      await app.ready();

      // injectWS resolves to a WebSocket instance when the upgrade is accepted.
      // If the server rejects (non-101), injectWS throws — so a resolved promise
      // IS the proof that the connection was accepted.
      const ws = await app.injectWS("/ws/plans", {
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      // The ws object being defined and connected (readyState 0=CONNECTING or 1=OPEN)
      // proves the upgrade was accepted. Close cleanly.
      expect(ws).toBeDefined();
      // Wait for open so we can close gracefully
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

    it("registers the socket in the WsRegistry on connection", async () => {
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

      // registry.register must have been called with the correct userId
      expect(registerSpy).toHaveBeenCalledWith(USER_A, expect.anything());
    });
  });

  describe("unauthenticated connection", () => {
    it("rejects the WS upgrade with a non-101 response when no auth token is provided", async () => {
      const db = buildSessionDb(); // no session row → authContext = null
      app = await buildTestApp({ db });
      await app.ready();

      // @fastify/websocket rejects injectWS with an error when the server returns
      // a non-101 (Switching Protocols) response (e.g. 401 Unauthorized).
      await expect(
        app.injectWS("/ws/plans")
      ).rejects.toThrow(/server response/i);
    });
  });

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

      // Wait for the connection to open
      await new Promise<void>((resolve) => {
        ws.on("open", resolve);
        setTimeout(resolve, 1000);
      });

      // Notify via the registry with a 'ready' payload
      const payload = { planId: "plan-abc-123", status: "ready" as const };
      registry.notify(USER_A, payload);

      // Small wait for the message to propagate
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

      // Notify with a 'failed' payload
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
