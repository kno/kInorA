/**
 * Tests for the authenticated WebSocket plan-status route:
 *   GET /ws/plans  (WebSocket upgrade)
 *
 * Auth paths tested:
 *   1. Authorization: Bearer <token> header (existing clients, test harness)
 *   2. kinora_session cookie (browser WebSocket — same-origin, auto-sent by the
 *      browser on the WS upgrade; the preferred hardened path, issue #42)
 *   3. ?token=<token> query param (retained fallback for non-browser / cross-origin
 *      local-dev clients — browsers cannot send custom headers)
 *   4. Neither header, cookie, nor query param → 401
 *
 * Strategy:
 * - Use app.injectWS(...) from @fastify/websocket to test the WS upgrade path
 * - For exact 401 status: use app.inject() with Upgrade headers (HTTP-level assertion)
 * - Mock the session DB so authenticated and unauthenticated paths can be exercised
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCookie from "@fastify/cookie";
import { authPlugin } from "../../auth/plugin.js";
import { wsRoutes } from "../ws.js";
import { WsRegistry } from "../../ws/registry.js";
import type { Database } from "../../db/client.js";
import {
  VALID_TOKEN,
  createCyclingAuthMockDb,
  buildSessionRow as buildSharedSessionRow,
  buildActiveMembershipRow,
  buildSuspendedMembershipRow,
} from "../../test-support/auth-mocks.js";

// --- Fixtures ---

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";

// --- Helpers ---

// WS suites use tenant/user IDs distinct from the shared defaults, so build
// session and membership rows scoped to this suite's tenant/user.
function buildSessionRow() {
  return buildSharedSessionRow({ tenantId: TENANT_A, userId: USER_A });
}

/**
 * Build a mock DB for the WS auth flow. Every authenticated WS request performs
 * exactly two ordered selects — session lookup then tenant-scoped membership
 * re-check — via either the Bearer onRequest hook or the ?token= preValidation
 * path (never interleaved), so the shared cycling mock repeats the (session,
 * membership) pair per request.
 *
 * `sessionRow` and `membershipRow` are independent: pass a valid session with a
 * suspended membership, or with `null` membership, to model tenant-scoped
 * revocation. Omitting `sessionRow` yields the unauthenticated case.
 */
function buildSessionDb(
  sessionRow?: unknown,
  membershipRow: unknown = buildActiveMembershipRow({
    tenantId: TENANT_A,
    userId: USER_A,
  })
): Database {
  return createCyclingAuthMockDb({
    sessionRows: sessionRow ? [sessionRow] : [],
    // Membership is only queried when a session resolves; a null membershipRow
    // models "no membership for this tenant" (missing-membership revocation).
    membershipRows: membershipRow ? [membershipRow] : [],
  });
}

const ALLOWED_ORIGIN = "https://app.kinora.io";

async function buildTestApp(opts: {
  db: Database;
  registry?: WsRegistry;
  /** Origin allowlist for the CSWSH gate. Defaults to [ALLOWED_ORIGIN]. */
  allowedOrigins?: string[];
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
  // @fastify/cookie parses request.cookies so wsRoutes can read the
  // kinora_session cookie on the same-origin browser WS upgrade (issue #42).
  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket);
  // Pass db so wsRoutes can resolve cookie/?token= auth via the shared
  // resolveAuthContextFromToken (same SessionRepository + tenant-scoped
  // membershipRepo as the Bearer path). allowedOrigins drives the CSWSH gate.
  await app.register(wsRoutes, {
    registry: opts.registry ?? new WsRegistry(),
    db: opts.db,
    allowedOrigins: opts.allowedOrigins ?? [ALLOWED_ORIGIN],
  });

  return app;
}

/**
 * Resolve when the socket opens (auth accepted); reject when it errors.
 * No time-based success — the promise settles ONLY on an observable event.
 */
function waitForOpen(ws: { on: (ev: string, cb: (arg?: unknown) => void) => void; readyState?: number }): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if ((ws as { readyState?: number }).readyState === 1) {
      resolve();
      return;
    }
    ws.on("open", () => resolve());
    ws.on("error", (err) => reject(err instanceof Error ? err : new Error("ws error")));
  });
}

async function closeWs(ws: { close: () => void; on: (ev: string, cb: () => void) => void }): Promise<void> {
  ws.close();
  await new Promise<void>((resolve) => {
    ws.on("close", resolve);
    setTimeout(resolve, 500);
  });
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
    it("accepts the WS upgrade when a valid bearer token is provided (no Origin — non-browser)", async () => {
      const db = buildSessionDb(buildSessionRow());
      app = await buildTestApp({ db });
      await app.ready();

      // No Origin header → non-browser client; the CSWSH gate does not apply.
      const ws = await app.injectWS("/ws/plans", {
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(ws).toBeDefined();
      // Resolve ONLY from onopen; reject on error. No time-based success.
      await waitForOpen(ws);
      await closeWs(ws);
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

      await waitForOpen(ws);
      await closeWs(ws);

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

      // Browser-style: no Authorization header, token in query string.
      // No Origin header → non-browser fallback client; CSWSH gate does not apply.
      const ws = await app.injectWS(`/ws/plans?token=${VALID_TOKEN}`);

      expect(ws).toBeDefined();
      await waitForOpen(ws);
      await closeWs(ws);
    });

    it("registers the socket under the correct userId when authenticated via ?token=", async () => {
      const db = buildSessionDb(buildSessionRow());
      const registry = new WsRegistry();
      const registerSpy = vi.spyOn(registry, "register");
      app = await buildTestApp({ db, registry });
      await app.ready();

      const ws = await app.injectWS(`/ws/plans?token=${VALID_TOKEN}`);

      await waitForOpen(ws);
      await closeWs(ws);

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
  // Membership revocation — tenant-scoped fail-secure re-check on WS paths.
  // A valid, unexpired session is NOT enough: if the membership for the
  // session's tenant is suspended or missing, the WS upgrade must be REJECTED
  // on the Bearer, ?token=, AND cookie paths (mirrors the HTTP coverage in
  // plugin.test.ts). Every path runs the same resolveAuthContextFromToken with
  // the tenant-scoped membershipRepo.
  // -------------------------------------------------------------------------
  describe("membership revocation — suspended / missing membership rejected", () => {
    const WS_HEADERS = {
      connection: "upgrade",
      upgrade: "websocket",
      "sec-websocket-key": Buffer.from("test-key-12345678901").toString("base64"),
      "sec-websocket-version": "13",
    };

    it("rejects the Bearer WS upgrade when the membership is suspended", async () => {
      const db = buildSessionDb(
        buildSessionRow(),
        buildSuspendedMembershipRow({ tenantId: TENANT_A, userId: USER_A })
      );
      app = await buildTestApp({ db });
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/ws/plans",
        headers: { ...WS_HEADERS, authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    });

    it("rejects injectWS on the Bearer path when the membership is suspended", async () => {
      const db = buildSessionDb(
        buildSessionRow(),
        buildSuspendedMembershipRow({ tenantId: TENANT_A, userId: USER_A })
      );
      app = await buildTestApp({ db });
      await app.ready();

      await expect(
        app.injectWS("/ws/plans", {
          headers: { authorization: `Bearer ${VALID_TOKEN}` },
        })
      ).rejects.toThrow(/server response/i);
    });

    it("rejects the ?token= WS upgrade when the membership is suspended", async () => {
      const db = buildSessionDb(
        buildSessionRow(),
        buildSuspendedMembershipRow({ tenantId: TENANT_A, userId: USER_A })
      );
      app = await buildTestApp({ db });
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: `/ws/plans?token=${VALID_TOKEN}`,
        headers: WS_HEADERS,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    });

    it("rejects the Bearer WS upgrade when the user has no membership for the session tenant", async () => {
      // Valid session, but no membership row for that tenant → fail-secure deny.
      const db = buildSessionDb(buildSessionRow(), null);
      app = await buildTestApp({ db });
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/ws/plans",
        headers: { ...WS_HEADERS, authorization: `Bearer ${VALID_TOKEN}` },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    });

    it("rejects the ?token= WS upgrade when the user has no membership for the session tenant", async () => {
      const db = buildSessionDb(buildSessionRow(), null);
      app = await buildTestApp({ db });
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: `/ws/plans?token=${VALID_TOKEN}`,
        headers: WS_HEADERS,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    });

    it("rejects injectWS on the ?token= path when the membership is missing", async () => {
      const db = buildSessionDb(buildSessionRow(), null);
      app = await buildTestApp({ db });
      await app.ready();

      await expect(
        app.injectWS(`/ws/plans?token=${VALID_TOKEN}`)
      ).rejects.toThrow(/server response/i);
    });

    // Cross-cut of #23 (membership re-check) and #42 (cookie path + Origin gate):
    // the cookie path MUST enforce the same tenant-scoped revocation. Sends an
    // allowed Origin so the CSWSH gate passes and the failure is attributable to
    // the membership re-check, not the Origin gate.
    it("rejects the cookie WS upgrade when the membership is suspended (allowed Origin)", async () => {
      const db = buildSessionDb(
        buildSessionRow(),
        buildSuspendedMembershipRow({ tenantId: TENANT_A, userId: USER_A })
      );
      app = await buildTestApp({ db });
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/ws/plans",
        headers: {
          ...WS_HEADERS,
          origin: ALLOWED_ORIGIN,
          cookie: `kinora_session=${VALID_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    });

    it("rejects the cookie WS upgrade when the user has no membership for the session tenant (allowed Origin)", async () => {
      const db = buildSessionDb(buildSessionRow(), null);
      app = await buildTestApp({ db });
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/ws/plans",
        headers: {
          ...WS_HEADERS,
          origin: ALLOWED_ORIGIN,
          cookie: `kinora_session=${VALID_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    });

    it("rejects injectWS on the cookie path when the membership is missing (allowed Origin)", async () => {
      const db = buildSessionDb(buildSessionRow(), null);
      app = await buildTestApp({ db });
      await app.ready();

      await expect(
        app.injectWS("/ws/plans", {
          headers: {
            origin: ALLOWED_ORIGIN,
            cookie: `kinora_session=${VALID_TOKEN}`,
          },
        })
      ).rejects.toThrow(/server response/i);
    });
  });

  // -------------------------------------------------------------------------
  // Issue #42: kinora_session cookie auth path (same-origin browser WS upgrade).
  // Browsers auto-send the httpOnly cookie on a same-origin WS upgrade, so the
  // session token never has to be exposed to client JS or placed in the WS URL.
  // Browser requests carry an Origin header, so an allowed Origin is required.
  // -------------------------------------------------------------------------
  describe("authenticated connection — kinora_session cookie (browser same-origin path)", () => {
    it("accepts the WS upgrade with a valid cookie AND an allowed Origin (no header, no query param)", async () => {
      const db = buildSessionDb(buildSessionRow());
      app = await buildTestApp({ db });
      await app.ready();

      // Browser same-origin: allowed Origin + cookie only (no Authorization, no ?token=).
      const ws = await app.injectWS("/ws/plans", {
        headers: { cookie: `kinora_session=${VALID_TOKEN}`, origin: ALLOWED_ORIGIN },
      });

      expect(ws).toBeDefined();
      // Resolve ONLY from onopen; reject on error. No time-based success.
      await waitForOpen(ws);
      await closeWs(ws);
    });

    it("registers the socket under the correct userId when authenticated via the cookie with an allowed Origin", async () => {
      const db = buildSessionDb(buildSessionRow());
      const registry = new WsRegistry();
      const registerSpy = vi.spyOn(registry, "register");
      app = await buildTestApp({ db, registry });
      await app.ready();

      const ws = await app.injectWS("/ws/plans", {
        headers: { cookie: `kinora_session=${VALID_TOKEN}`, origin: ALLOWED_ORIGIN },
      });

      await waitForOpen(ws);
      await closeWs(ws);

      // Same userId resolution as the Bearer and query-param paths.
      expect(registerSpy).toHaveBeenCalledWith(USER_A, expect.anything());
    });

    it("returns HTTP 401 when the kinora_session cookie is invalid/expired (allowed Origin, HTTP-level assertion)", async () => {
      const db = buildSessionDb(); // no session → resolves null
      app = await buildTestApp({ db });
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/ws/plans",
        headers: {
          cookie: `kinora_session=${"z".repeat(64)}`,
          origin: ALLOWED_ORIGIN,
          connection: "upgrade",
          upgrade: "websocket",
          "sec-websocket-key": Buffer.from("test-key-12345678901").toString("base64"),
          "sec-websocket-version": "13",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // CSWSH gate (issue #42 hardening review). A cookie-authenticated WS upgrade
  // MUST validate the Origin header against an allowlist BEFORE authenticating.
  // A cross-site Origin (evil.com) with the ambient cookie must be rejected 403.
  // No-Origin clients (non-browser Bearer/?token=) are NOT gated.
  // -------------------------------------------------------------------------
  describe("CSWSH Origin gate — cookie/browser path", () => {
    it("returns HTTP 403 when the Origin is cross-site, even with a valid cookie (rejected BEFORE auth)", async () => {
      // Session row present: proves rejection is by Origin, not auth failure.
      const db = buildSessionDb(buildSessionRow());
      const findSpy = vi.spyOn(
        // Reach the underlying select to prove auth never ran.
        db as unknown as { select: () => unknown },
        "select"
      );
      app = await buildTestApp({ db });
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/ws/plans",
        headers: {
          cookie: `kinora_session=${VALID_TOKEN}`,
          origin: "https://evil.com",
          connection: "upgrade",
          upgrade: "websocket",
          "sec-websocket-key": Buffer.from("test-key-12345678901").toString("base64"),
          "sec-websocket-version": "13",
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "forbidden_origin" });
      // Rejected BEFORE authentication → the session DB was never queried.
      expect(findSpy).not.toHaveBeenCalled();
    });

    it("rejects injectWS from a cross-site Origin with a non-101 error", async () => {
      const db = buildSessionDb(buildSessionRow());
      app = await buildTestApp({ db });
      await app.ready();

      await expect(
        app.injectWS("/ws/plans", {
          headers: { cookie: `kinora_session=${VALID_TOKEN}`, origin: "https://evil.com" },
        })
      ).rejects.toThrow(/server response/i);
    });

    it("accepts a valid cookie when the Origin is in the allowlist", async () => {
      const db = buildSessionDb(buildSessionRow());
      app = await buildTestApp({ db, allowedOrigins: [ALLOWED_ORIGIN, "https://staging.kinora.io"] });
      await app.ready();

      const ws = await app.injectWS("/ws/plans", {
        headers: { cookie: `kinora_session=${VALID_TOKEN}`, origin: "https://staging.kinora.io" },
      });

      await waitForOpen(ws);
      await closeWs(ws);
    });

    it("still accepts a Bearer client that sends NO Origin (gate applies only to browser/Origin requests)", async () => {
      const db = buildSessionDb(buildSessionRow());
      app = await buildTestApp({ db });
      await app.ready();

      // Non-browser client: no Origin, Bearer header. Must NOT be gated.
      const ws = await app.injectWS("/ws/plans", {
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });

      await waitForOpen(ws);
      await closeWs(ws);
    });
  });

  // -------------------------------------------------------------------------
  // Issue #42: fail-secure — neither cookie, header, nor query param → 401.
  // Explicitly exercises the case where a cookie header exists but carries no
  // kinora_session value AND no ?token= fallback is present.
  // -------------------------------------------------------------------------
  describe("fail-secure — missing cookie AND missing token", () => {
    it("returns HTTP 401 when an unrelated cookie is present but there is no session cookie or token", async () => {
      const db = buildSessionDb(); // no session row
      app = await buildTestApp({ db });
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/ws/plans",
        headers: {
          cookie: "some_other_cookie=value",
          connection: "upgrade",
          upgrade: "websocket",
          "sec-websocket-key": Buffer.from("test-key-12345678901").toString("base64"),
          "sec-websocket-version": "13",
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
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
