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
  chatStreamTimeoutMs?: number;
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
    chatStreamTimeoutMs: opts.chatStreamTimeoutMs,
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

  it("streams token deltas then a terminal draft event (empty extraction → no write)", async () => {
    // The stub extractor returns an empty `{}` extraction. Merged onto the empty
    // current draft it changes nothing, so NO draft is committed — but the
    // terminal event is now `draft` (S2b), carrying the empty spec + all six
    // missingFields.
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
    expect(frames.at(-1)?.event).toBe("draft");
    expect(frames.filter((f) => f.event === "draft")).toHaveLength(1);
    const terminal = JSON.parse(frames.at(-1)!.data);
    expect(terminal.draftSpec).toEqual({});
    expect(terminal.missingFields).toEqual([
      "goal",
      "daysPerWeek",
      "sessionDurationMinutes",
      "location",
      "equipment",
      "limitations",
    ]);
    // Empty/no-op extraction never touches `plan_drafts`.
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

  // --- S2b: terminal structured extraction + draft commit ------------------

  /** Extractor that streams prose then returns a fixed structured extraction. */
  function richExtractor(
    extracted: PlanSpecDraft,
    tokens: string[] = ["Got ", "it."],
  ): PlanSpecExtractor & { extract: ReturnType<typeof vi.fn> } {
    return {
      async *streamReply(_input, signal) {
        for (const t of tokens) {
          if (signal.aborted) return;
          yield t;
        }
      },
      extract: vi.fn().mockResolvedValue(extracted),
    };
  }

  it("valid message → prose deltas then a terminal draft with the MERGED spec, committed once", async () => {
    const extractor = richExtractor({ goal: "hypertrophy", daysPerWeek: 4, equipment: ["dumbbells"] });
    const repo = buildPlanRepo();
    // Current draft already has a location; the merge must preserve it.
    repo.findCurrentDraft.mockResolvedValue({ step: 2, specJson: { location: "gym" } });

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
      payload: { message: "build muscle 4 days a week with dumbbells" },
    });

    const frames = parseSse(res.payload);
    expect(frames.filter((f) => f.event === "token").map((f) => JSON.parse(f.data).delta)).toEqual([
      "Got ",
      "it.",
    ]);
    expect(frames.at(-1)?.event).toBe("draft");
    const terminal = JSON.parse(frames.at(-1)!.data);
    // Merged: extracted fields + preserved current `location`.
    expect(terminal.draftSpec).toEqual({
      location: "gym",
      goal: "hypertrophy",
      daysPerWeek: 4,
      equipment: ["dumbbells"],
    });
    expect(terminal.missingFields).toEqual(["sessionDurationMinutes", "limitations"]);
    expect(terminal.assistantMessage).toBe("Got it.");
    // Committed exactly once, only on the terminal event, with the merged spec.
    expect(repo.upsertDraft).toHaveBeenCalledTimes(1);
    expect(repo.upsertDraft).toHaveBeenCalledWith(TENANT_A, USER_A, 2, terminal.draftSpec);
  });

  it("mid-stream extraction (Pass 2) failure → terminal error and the draft is NOT written", async () => {
    const extractor: PlanSpecExtractor = {
      async *streamReply(_input, signal) {
        for (const t of ["thinking", "..."]) {
          if (signal.aborted) return;
          yield t;
        }
      },
      extract: vi.fn().mockRejectedValue(new Error("provider 500")),
    };
    const repo = buildPlanRepo();
    repo.findCurrentDraft.mockResolvedValue({ step: 1, specJson: { goal: "strength" } });

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
      payload: { message: "make it harder" },
    });

    const frames = parseSse(res.payload);
    // Some prose streamed, then a terminal error — never a `draft`.
    expect(frames.some((f) => f.event === "token")).toBe(true);
    expect(frames.at(-1)?.event).toBe("error");
    expect(JSON.parse(frames.at(-1)!.data)).toEqual({ error: "chat_stream_failed" });
    expect(frames.some((f) => f.event === "draft")).toBe(false);
    // Draft untouched.
    expect(repo.upsertDraft).not.toHaveBeenCalled();
  });

  it("empty/whitespace message → NO LLM work, a clarifying draft, draft unchanged", async () => {
    const extractor = richExtractor({ goal: "strength" });
    const streamSpy = vi.spyOn(extractor, "streamReply");
    const repo = buildPlanRepo();
    repo.findCurrentDraft.mockResolvedValue({ step: 1, specJson: { daysPerWeek: 3 } });

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
      payload: { message: "   " },
    });

    const frames = parseSse(res.payload);
    expect(frames.at(-1)?.event).toBe("draft");
    const terminal = JSON.parse(frames.at(-1)!.data);
    // Draft is echoed UNCHANGED with the still-missing fields.
    expect(terminal.draftSpec).toEqual({ daysPerWeek: 3 });
    expect(terminal.missingFields).toContain("goal");
    // No extractor call, no write.
    expect(streamSpy).not.toHaveBeenCalled();
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(repo.upsertDraft).not.toHaveBeenCalled();
  });

  it("stream timeout → terminal error, LLM aborted, draft NOT written", async () => {
    let sawAbort = false;
    const extractor: PlanSpecExtractor = {
      async *streamReply(_input, signal) {
        signal.addEventListener("abort", () => {
          sawAbort = true;
        });
        // Stall well past the injected deadline.
        for (let i = 0; i < 100; i++) {
          if (signal.aborted) return;
          yield `tok${i} `;
          await new Promise((r) => setTimeout(r, 30));
        }
      },
      extract: vi.fn().mockResolvedValue({ goal: "strength" } as PlanSpecDraft),
    };
    const repo = buildPlanRepo();

    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      chatEntitlement: allowGate(),
      chatExtractor: extractor,
      chatStreamTimeoutMs: 40,
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/chat",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { message: "build muscle" },
    });

    const frames = parseSse(res.payload);
    expect(frames.at(-1)?.event).toBe("error");
    expect(JSON.parse(frames.at(-1)!.data)).toEqual({ error: "chat_stream_timeout" });
    expect(sawAbort).toBe(true);
    // Timed out before Pass 2 / commit.
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(repo.upsertDraft).not.toHaveBeenCalled();
  });

  it("honors backpressure: when raw.write() returns false it awaits drain, losing no token", async () => {
    // Force the FIRST write of each hijacked ServerResponse to return false and
    // schedule a 'drain' — mirroring a full kernel send buffer. Every token +
    // the terminal draft must still arrive in order.
    const originalWrite = http.ServerResponse.prototype.write;
    const throttled = new WeakSet<ServerResponse>();
    http.ServerResponse.prototype.write = function (
      this: ServerResponse,
      ...args: Parameters<ServerResponse["write"]>
    ) {
      const result = originalWrite.apply(this, args);
      if (!throttled.has(this)) {
        throttled.add(this);
        // Emit 'drain' on the next tick so the awaited writeFrame resolves.
        setImmediate(() => this.emit("drain"));
        return false;
      }
      return result;
    } as typeof originalWrite;

    try {
      const extractor = richExtractor({ goal: "hypertrophy" }, ["a", "b", "c"]);
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
      // No token lost despite the backpressure on the first write.
      expect(frames.filter((f) => f.event === "token").map((f) => JSON.parse(f.data).delta)).toEqual([
        "a",
        "b",
        "c",
      ]);
      expect(frames.at(-1)?.event).toBe("draft");
    } finally {
      http.ServerResponse.prototype.write = originalWrite;
    }
  });

  it("performs no vector-store embedding of the chat transcript", async () => {
    // Privacy/Threat Matrix: raw-transcript embedding. The route is wired with
    // ONLY the draft repo, gate and extractor — there is no embedding/vector
    // seam reachable from a chat turn. This guards that the turn's persistence
    // surface stays limited to `plan_drafts` (upsertDraft) and nothing else.
    const extractor = richExtractor({ goal: "hypertrophy", limitations: [{ text: "bad knee", isWarning: true }] });
    const repo = buildPlanRepo();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      chatEntitlement: allowGate(),
      chatExtractor: extractor,
    });

    await app.inject({
      method: "POST",
      url: "/plan-specs/chat",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { message: "build muscle, I have a bad knee" },
    });

    // The only write is the draft upsert — no other repo method wrote anything.
    expect(repo.upsertDraft).toHaveBeenCalledTimes(1);
    expect(repo.promoteDraftToSpec).not.toHaveBeenCalled();
  });

  // --- Review fixes: missingFields steering, Pass-2 abort, drain-no-hang ---

  it("threads the CURRENT draft's missingFields into the extractor input so the prompt is steered", async () => {
    // WARNING fix: missingFields was never populated on ChatExtractInput, so
    // buildExtractionPrompt always rendered "STILL MISSING: (none)". An empty
    // currentDraft must yield all six missing fields on BOTH streamReply and
    // extract's input.
    let capturedStreamInput: ChatExtractInput | undefined;
    let capturedExtractInput: ChatExtractInput | undefined;
    const extractor: PlanSpecExtractor = {
      async *streamReply(input, signal) {
        capturedStreamInput = input;
        if (signal.aborted) return;
        yield "ok";
      },
      extract: vi.fn(async (input: ChatExtractInput) => {
        capturedExtractInput = input;
        return { goal: "hypertrophy" };
      }),
    };
    const repo = buildPlanRepo();
    repo.findCurrentDraft.mockResolvedValue(null);

    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      chatEntitlement: allowGate(),
      chatExtractor: extractor,
    });

    await app.inject({
      method: "POST",
      url: "/plan-specs/chat",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { message: "build muscle" },
    });

    const expectedMissing = [
      "goal",
      "daysPerWeek",
      "sessionDurationMinutes",
      "location",
      "equipment",
      "limitations",
    ];
    expect(capturedStreamInput?.missingFields).toEqual(expectedMissing);
    expect(capturedExtractInput?.missingFields).toEqual(expectedMissing);
  });

  it("aborts an in-flight Pass 2 (extract) on timeout instead of blocking on it, and emits the terminal error promptly", async () => {
    // HIGH fix: previously extract() had no signal parameter at all, so a
    // timeout firing DURING Pass 2 could not cancel it — the handler would
    // block until the (possibly never-resolving) call settled on its own.
    let extractSignal: AbortSignal | undefined;
    let extractSawAbort = false;
    const extractor: PlanSpecExtractor = {
      async *streamReply() {
        yield "ok";
      },
      extract: (_input, signal) =>
        new Promise((_resolve, reject) => {
          extractSignal = signal;
          signal?.addEventListener(
            "abort",
            () => {
              extractSawAbort = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
          // Deliberately never resolves on its own — only an abort settles it.
        }),
    };
    const repo = buildPlanRepo();

    const start = Date.now();
    app = await buildTestApp({
      db: buildSessionDb(),
      repo,
      chatEntitlement: allowGate(),
      chatExtractor: extractor,
      chatStreamTimeoutMs: 40,
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/chat",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { message: "build muscle" },
    });
    const elapsedMs = Date.now() - start;

    const frames = parseSse(res.payload);
    expect(frames.at(-1)?.event).toBe("error");
    expect(JSON.parse(frames.at(-1)!.data)).toEqual({ error: "chat_stream_timeout" });
    // The route passed a real signal into extract() and that signal aborted.
    expect(extractSignal).toBeInstanceOf(AbortSignal);
    expect(extractSawAbort).toBe(true);
    // Resolved promptly (well within a generous bound), not after some much
    // longer/never-resolving wait — proves Pass 2 was actually cancelled.
    expect(elapsedMs).toBeLessThan(2000);
    expect(repo.upsertDraft).not.toHaveBeenCalled();
  });

  it("writeFrame does not hang when the signal is ALREADY aborted and write() returns false", async () => {
    // HIGH fix: the drain-wait escaped ONLY via a NEW `abort` event listener; if
    // the signal was already aborted before the wait started (e.g. the
    // timeout's own terminal-error write racing an abort that just fired), that
    // listener would never see the transition and the promise hung forever,
    // leaking the handler and socket.
    const originalWrite = http.ServerResponse.prototype.write;
    http.ServerResponse.prototype.write = function (
      this: ServerResponse,
      ...args: Parameters<ServerResponse["write"]>
    ) {
      // Always report backpressure — never actually flush 'drain' from here.
      originalWrite.apply(this, args);
      return false;
    } as typeof originalWrite;

    try {
      const extractor: PlanSpecExtractor = {
        async *streamReply(_input, signal) {
          for (let i = 0; i < 20; i++) {
            if (signal.aborted) return;
            yield `tok${i} `;
            await new Promise((r) => setTimeout(r, 5));
          }
        },
        extract: vi.fn().mockResolvedValue({} as PlanSpecDraft),
      };
      const repo = buildPlanRepo();

      app = await buildTestApp({
        db: buildSessionDb(),
        repo,
        chatEntitlement: allowGate(),
        chatExtractor: extractor,
        // Very short deadline: the handler must still reach `finally`/`raw.end()`
        // promptly even though every write() reports backpressure and 'drain'
        // never naturally fires (simulating a stalled/dead client — the very
        // condition that causes a timeout in the first place).
        chatStreamTimeoutMs: 30,
      });

      const injectPromise = app.inject({
        method: "POST",
        url: "/plan-specs/chat",
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
        payload: { message: "build muscle" },
      });

      const res = await Promise.race([
        injectPromise,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 2000)),
      ]);

      // The handler MUST have completed (reached finally/raw.end()) — a hang
      // would leave `res` undefined after the 2s race timeout.
      expect(res).toBeDefined();
    } finally {
      http.ServerResponse.prototype.write = originalWrite;
    }
  });
});
