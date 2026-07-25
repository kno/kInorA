import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerResponse } from "node:http";
import { authPlugin } from "../../auth/plugin.js";
import { planRoutes, type PlanRouteRepo } from "../plan.js";
import type { ChatEntitlementPort } from "../../billing/chat-entitlement.js";
import type { ChatExtractInput, PlanSpecExtractor } from "../../ai/extraction-port.js";
import type { Database } from "../../db/client.js";
import type { PlanSpecDraft } from "@kinora/contracts";
import {
  createAuthMockDb,
  buildActiveMembershipRow,
  type AuthMockDb,
} from "../../test-support/auth-mocks.js";

// --- Shared fixtures -------------------------------------------------------

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_A = "aaaaaaaa-0000-0000-0000-000000000002";
const VALID_TOKEN = "a".repeat(64);
const SESSION_HASH = "b".repeat(64);

const ACTIVE_MEMBERSHIP_ROW = buildActiveMembershipRow({ tenantId: TENANT_A, userId: USER_A });

function sessionSelectChain(
  sessionRows: unknown[],
  membershipRows: unknown[] = [ACTIVE_MEMBERSHIP_ROW],
): ReturnType<typeof vi.fn> & { resolvedByCall: AuthMockDb["resolvedByCall"] } {
  const mock = createAuthMockDb({ sessionRows, membershipRows });
  return Object.assign(mock.select, { resolvedByCall: mock.resolvedByCall }) as ReturnType<
    typeof vi.fn
  > & { resolvedByCall: AuthMockDb["resolvedByCall"] };
}

function buildSessionDb(tenantId = TENANT_A, userId = USER_A): Database {
  const sessionRows = [
    {
      tokenHash: SESSION_HASH,
      userId,
      tenantId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  ];
  return { select: sessionSelectChain(sessionRows) } as unknown as Database;
}

// --- Port doubles ----------------------------------------------------------

type PlanRepoMock = { [K in keyof PlanRouteRepo]: ReturnType<typeof vi.fn> };

function buildPlanRepo(): PlanRepoMock {
  return {
    upsertDraft: vi.fn().mockResolvedValue({ step: 1, specJson: {} }),
    findCurrentDraft: vi.fn().mockResolvedValue(null),
    promoteDraftToSpec: vi.fn(),
    findPlanById: vi.fn(),
    findLatestPlanBySpec: vi.fn(),
    findAllPlansByUser: vi.fn().mockResolvedValue([]),
  };
}

const noopGenerationService = {
  startGeneration: () => Promise.reject(new Error("unexpected call")),
  assertGeneratable: () => Promise.reject(new Error("unexpected call")),
};

/** A gate that allows every request (Pro). Records the scope it was checked with. */
function allowGate(): ChatEntitlementPort & { check: ReturnType<typeof vi.fn> } {
  return { check: vi.fn().mockResolvedValue({ allowed: true }) };
}

/** A gate that denies with `premium_required` (Free tenant). */
function denyGate(reason = "premium_required"): ChatEntitlementPort & {
  check: ReturnType<typeof vi.fn>;
} {
  return { check: vi.fn().mockResolvedValue({ allowed: false, reason }) };
}

/** Deterministic stub extractor: streams three canned tokens, no network/LLM. */
const CANNED_TOKENS = ["Got ", "it — ", "done."];

function stubExtractor(): PlanSpecExtractor & { streamReply: ReturnType<typeof vi.fn> } {
  const streamReply = vi.fn(async function* (
    _input: ChatExtractInput,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    for (const token of CANNED_TOKENS) {
      if (signal.aborted) return;
      yield token;
    }
  });
  return {
    streamReply,
    extract: vi.fn().mockResolvedValue({} as PlanSpecDraft),
  } as PlanSpecExtractor & { streamReply: ReturnType<typeof vi.fn> };
}

async function buildTestApp(opts: {
  db: Database;
  repo?: PlanRepoMock;
  chatEntitlement: ChatEntitlementPort;
  chatExtractor: PlanSpecExtractor;
}): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: "Bad Request" });
    }
    return reply.code(500).send({ error: "Internal Server Error" });
  });
  await app.register(authPlugin, { db: opts.db });
  await app.register(planRoutes, {
    repo: opts.repo ?? buildPlanRepo(),
    generationService: noopGenerationService,
    chatEntitlement: opts.chatEntitlement,
    chatExtractor: opts.chatExtractor,
  });
  return app;
}

/** Parse an SSE payload into ordered { event, data } frames. */
function parseSse(payload: string): Array<{ event: string; data: string }> {
  return payload
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "";
      const data = lines.find((l) => l.startsWith("data:"))?.slice(5).trim() ?? "";
      return { event, data };
    });
}

// --- Tests -----------------------------------------------------------------

describe("POST /plan-specs/chat (SSE transport + Pro gate)", () => {
  let app: FastifyInstance | undefined;

  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 401 when unauthenticated", async () => {
    app = await buildTestApp({
      db: { select: sessionSelectChain([]) } as unknown as Database,
      chatEntitlement: allowGate(),
      chatExtractor: stubExtractor(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/chat",
      payload: { message: "build muscle" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("denies a Free tenant with 403 premium_required BEFORE any streaming/LLM work", async () => {
    const gate = denyGate("premium_required");
    const extractor = stubExtractor();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: gate,
      chatExtractor: extractor,
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/chat",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { message: "build muscle" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "premium_required" });
    // Gate ran; no stream was ever produced (fail-closed before any work).
    expect(gate.check).toHaveBeenCalledTimes(1);
    expect(extractor.streamReply).not.toHaveBeenCalled();
    // Not an SSE response — a plain JSON denial.
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("checks the gate with the authContext identity, ignoring body-injected tenant/tier", async () => {
    const gate = allowGate();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: gate,
      chatExtractor: stubExtractor(),
    });

    await app.inject({
      method: "POST",
      url: "/plan-specs/chat",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      // Spoofed tenant/tier in the body MUST be ignored.
      payload: { message: "build muscle", tenantId: "attacker", tier: "pro" },
    });

    expect(gate.check).toHaveBeenCalledWith({ tenantId: TENANT_A, userId: USER_A });
  });

  it("Pro tenant gets 200 text/event-stream with the correct SSE headers", async () => {
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      chatExtractor: stubExtractor(),
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/chat",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { message: "build muscle" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["connection"]).toBe("keep-alive");
    expect(res.headers["x-accel-buffering"]).toBe("no");
  });

  it("streams the stub token deltas then a terminal done event", async () => {
    const extractor = stubExtractor();
    const repo = buildPlanRepo();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      chatEntitlement: allowGate(),
      chatExtractor: extractor,
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/chat",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { message: "build muscle" },
    });

    const frames = parseSse(res.payload);
    const tokenFrames = frames.filter((f) => f.event === "token");
    expect(tokenFrames.map((f) => JSON.parse(f.data).delta)).toEqual(CANNED_TOKENS);
    // Exactly one terminal event, and it is the last frame.
    expect(frames.at(-1)?.event).toBe("done");
    expect(frames.filter((f) => f.event === "done")).toHaveLength(1);
    // S2a is a stub pass-through: NO draft is committed (that is S2b).
    expect(repo.upsertDraft).not.toHaveBeenCalled();
    // The extractor received the streaming AbortSignal.
    const [, signalArg] = extractor.streamReply.mock.calls[0]!;
    expect(signalArg).toBeInstanceOf(AbortSignal);
  });

  it("stops emission and writes no draft when the client disconnects mid-stream", async () => {
    // Threat Matrix: client disconnect / abort. Uses a real listening socket so
    // a genuine client abort triggers `request.raw` close on the server.
    let resolveAborted: (v: boolean) => void;
    const aborted = new Promise<boolean>((resolve) => {
      resolveAborted = resolve;
    });

    const slowExtractor: PlanSpecExtractor = {
      async *streamReply(_input, signal) {
        signal.addEventListener("abort", () => resolveAborted(true), { once: true });
        for (let i = 0; i < 200; i++) {
          if (signal.aborted) return;
          yield `tok${i} `;
          await new Promise((r) => setTimeout(r, 10));
        }
      },
      extract: vi.fn().mockResolvedValue({} as PlanSpecDraft),
    };

    const repo = buildPlanRepo();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      chatEntitlement: allowGate(),
      chatExtractor: slowExtractor,
    });

    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no listening port");
    const port = address.port;

    const ac = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/plan-specs/chat`, {
      method: "POST",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ message: "build muscle" }),
      signal: ac.signal,
    });

    const reader = response.body!.getReader();
    await reader.read(); // receive at least the first chunk
    ac.abort();
    await reader.cancel().catch(() => {});

    const observed = await Promise.race([
      aborted,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);

    expect(observed).toBe(true);
    expect(repo.upsertDraft).not.toHaveBeenCalled();
  });

  it("cleans up quietly on a socket-level error without crashing the process", async () => {
    // CRITICAL fix regression guard: a mid-stream socket failure (e.g. a client
    // TCP RESET → ECONNRESET) fires an 'error' event on the hijacked
    // `reply.raw` (http.ServerResponse). With NO 'error' listener attached,
    // Node re-throws this as an uncaught exception that crashes the whole
    // process (every tenant, not just this request).
    //
    // Deterministic reproduction: monkeypatch `http.ServerResponse.prototype.write`
    // to CAPTURE the exact `reply.raw` instance the route hijacked (no other
    // seam exposes it), then emit a synthetic 'error' on it from a detached
    // `setImmediate` turn — mirroring how Node's own socket internals dispatch
    // a real ECONNRESET, OUTSIDE any try/catch on our call stack. If the fix's
    // listener is missing, this reliably surfaces as `process.on("uncaughtException")`
    // instead of being silently handled.
    const originalWrite = http.ServerResponse.prototype.write;
    let capturedRes: ServerResponse | undefined;
    http.ServerResponse.prototype.write = function (
      this: ServerResponse,
      ...args: Parameters<ServerResponse["write"]>
    ) {
      capturedRes ??= this;
      return originalWrite.apply(this, args);
    } as typeof originalWrite;

    let resolveAborted: (v: boolean) => void;
    const aborted = new Promise<boolean>((resolve) => {
      resolveAborted = resolve;
    });

    const slowExtractor: PlanSpecExtractor = {
      async *streamReply(_input, signal) {
        signal.addEventListener("abort", () => resolveAborted(true), { once: true });
        for (let i = 0; i < 50; i++) {
          if (signal.aborted) return;
          yield `tok${i} `;
          await new Promise((r) => setTimeout(r, 20));
        }
      },
      extract: vi.fn().mockResolvedValue({} as PlanSpecDraft),
    };

    const repo = buildPlanRepo();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      chatEntitlement: allowGate(),
      chatExtractor: slowExtractor,
    });

    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no listening port");
    const port = address.port;

    let uncaught: unknown;
    const onUncaught = (err: unknown) => {
      uncaught = err;
    };
    process.on("uncaughtException", onUncaught);

    const ac = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/plan-specs/chat`, {
        method: "POST",
        headers: { authorization: `Bearer ${VALID_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ message: "build muscle" }),
        signal: ac.signal,
      });
      const reader = response.body!.getReader();
      await reader.read(); // at least one write() happened → capturedRes is set

      if (!capturedRes) throw new Error("test setup failed: no ServerResponse captured");
      const simulated = new Error("simulated ECONNRESET");
      const target = capturedRes;
      // Detached turn: mirrors Node's own socket-internal error dispatch, which
      // is OUTSIDE any user try/catch — the real-world crash path.
      await new Promise<void>((resolve) => {
        setImmediate(() => {
          target.emit("error", simulated);
          resolve();
        });
      });
      // Give the event loop a tick for any resulting uncaughtException to surface.
      await new Promise((r) => setTimeout(r, 50));

      await reader.cancel().catch(() => {});
    } finally {
      ac.abort();
      process.removeListener("uncaughtException", onUncaught);
      http.ServerResponse.prototype.write = originalWrite;
    }

    expect(uncaught).toBeUndefined();

    const observed = await Promise.race([
      aborted,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);
    expect(observed).toBe(true);
    expect(repo.upsertDraft).not.toHaveBeenCalled();
  });

  it("rejects an over-limit message with 400 before any streaming/LLM work", async () => {
    const extractor = stubExtractor();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      chatExtractor: extractor,
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/chat",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { message: "a".repeat(4001) },
    });

    expect(res.statusCode).toBe(400);
    expect(extractor.streamReply).not.toHaveBeenCalled();
  });
});
