import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { planRoutes, type PlanRouteRepo } from "../plan.js";
import type { ChatEntitlementPort } from "../../billing/chat-entitlement.js";
import type {
  SpeechTranscriber,
  TranscribeInput,
  TranscribeResult,
} from "../../ai/speech-transcriber-port.js";
import type { Database } from "../../db/client.js";
import { ProviderRateLimitError } from "../../ai/provider-errors.js";
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
    commitDraft: vi.fn().mockResolvedValue({ step: 1, specJson: {}, version: 1 }),
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

/** A gate that denies with a reason (Free / expired / canceled tenant). */
function denyGate(reason = "premium_required"): ChatEntitlementPort & {
  check: ReturnType<typeof vi.fn>;
} {
  return { check: vi.fn().mockResolvedValue({ allowed: false, reason }) };
}

/** A gate whose check THROWS — must fail closed (deny), never allow work. */
function throwingGate(): ChatEntitlementPort & { check: ReturnType<typeof vi.fn> } {
  return { check: vi.fn().mockRejectedValue(new Error("entitlement reader down")) };
}

const CANNED_TEXT = "build muscle four days a week with dumbbells";

/** Deterministic transcriber double; records how it was called. */
function fakeTranscriber(
  result: TranscribeResult = { text: CANNED_TEXT, unclear: false },
): SpeechTranscriber & { transcribe: ReturnType<typeof vi.fn> } {
  return {
    transcribe: vi.fn(
      (_input: TranscribeInput, _signal?: AbortSignal): Promise<TranscribeResult> =>
        Promise.resolve(result),
    ),
  };
}

/** Transcriber that rejects with a provider transport error (stack must NOT leak). */
function throwingTranscriber(): SpeechTranscriber & { transcribe: ReturnType<typeof vi.fn> } {
  return {
    transcribe: vi.fn().mockRejectedValue(
      new Error("OpenAI upstream 500 — secret-internal-stack-detail"),
    ),
  };
}

/** Transcriber that rejects with a rate-limit/quota-exhausted failure. */
function rateLimitedTranscriber(): SpeechTranscriber & { transcribe: ReturnType<typeof vi.fn> } {
  return {
    transcribe: vi.fn().mockRejectedValue(new ProviderRateLimitError("gemini", "stt")),
  };
}

/** A recording logger so tests can assert audio/transcript are NEVER logged. */
function recordingLogger(): {
  info: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  debug: (...a: unknown[]) => void;
  fatal: (...a: unknown[]) => void;
  trace: (...a: unknown[]) => void;
  child: () => unknown;
  level: string;
  records: unknown[];
} {
  const records: unknown[] = [];
  const safe = (value: unknown): string => {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[circular]";
        seen.add(v);
      }
      if (typeof v === "bigint") return v.toString();
      return v;
    });
  };
  const log = (...args: unknown[]) => {
    // Store a circular-safe string snapshot so a later assertion can scan every
    // logged value without JSON.stringify choking on Fastify's bound logger refs.
    records.push(args.map((a) => safe(a)));
  };
  const logger = {
    records,
    level: "info",
    info: log,
    error: log,
    warn: log,
    debug: log,
    fatal: log,
    trace: log,
    child() {
      return logger;
    },
  };
  return logger;
}

// --- Multipart body helper -------------------------------------------------

interface MultipartPart {
  field: string;
  filename?: string;
  contentType?: string;
  data: Buffer | string;
}

function multipartPayload(parts: MultipartPart[]): {
  body: Buffer;
  headers: Record<string, string>;
} {
  const boundary = `----kinoraTestBoundary${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    let disposition = `Content-Disposition: form-data; name="${p.field}"`;
    if (p.filename !== undefined) disposition += `; filename="${p.filename}"`;
    chunks.push(Buffer.from(`${disposition}\r\n`));
    if (p.contentType) chunks.push(Buffer.from(`Content-Type: ${p.contentType}\r\n`));
    chunks.push(Buffer.from("\r\n"));
    chunks.push(Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

/** A small, valid audio upload part (webm). */
function audioPart(data: Buffer | string = "fake-opus-audio-bytes"): MultipartPart {
  return { field: "audio", filename: "clip.webm", contentType: "audio/webm", data };
}

async function buildTestApp(opts: {
  db: Database;
  repo?: PlanRepoMock;
  chatEntitlement: ChatEntitlementPort;
  transcriber?: SpeechTranscriber;
  logger?: ReturnType<typeof recordingLogger>;
}): Promise<FastifyInstance> {
  const app = Fastify(opts.logger ? { loggerInstance: opts.logger as never } : {});
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
    transcriber: opts.transcriber,
  });
  return app;
}

// --- Tests -----------------------------------------------------------------

describe("POST /plan-specs/transcribe (Pro-gated, capped, no-persistence STT)", () => {
  let app: FastifyInstance | undefined;

  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  // --- Auth + Pro gate (fail-closed BEFORE any transcription) ---------------

  it("returns 401 when unauthenticated (no transcribe call)", async () => {
    const transcriber = fakeTranscriber();
    app = await buildTestApp({
      db: { select: sessionSelectChain([]) } as unknown as Database,
      chatEntitlement: allowGate(),
      transcriber,
    });

    const mp = multipartPayload([audioPart()]);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: mp.headers,
      payload: mp.body,
    });

    expect(res.statusCode).toBe(401);
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it("denies a Free tenant with 403 premium_required BEFORE any transcription work", async () => {
    const gate = denyGate("premium_required");
    const transcriber = fakeTranscriber();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: gate,
      transcriber,
    });

    const mp = multipartPayload([audioPart()]);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "premium_required" });
    expect(gate.check).toHaveBeenCalledTimes(1);
    // Fail-closed: the transcriber is NEVER reached for a non-Pro tenant.
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("propagates the entitlement lapse reason on denial (expired trial → 403)", async () => {
    const gate = denyGate("trial_expired");
    const transcriber = fakeTranscriber();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: gate,
      transcriber,
    });

    const mp = multipartPayload([audioPart()]);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "trial_expired" });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it("fails CLOSED (transcriber never reached) when the gate check THROWS, and surfaces as a 5xx — NOT premium_required", async () => {
    // Review fix: a gate THROW is an infra/outage failure, not a denial
    // decision. Reporting it as 403 premium_required would mislabel a
    // transient entitlement-reader/DB outage as "you must upgrade" to a paying
    // Pro user, and would mask the outage from 5xx alerting. It must still
    // fail closed (the transcriber is never called) but surface as a 5xx,
    // exactly like the chat route's uncaught-throw convention.
    const gate = throwingGate();
    const transcriber = fakeTranscriber();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: gate,
      transcriber,
    });

    const mp = multipartPayload([audioPart()]);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.statusCode).toBeLessThan(600);
    expect(gate.check).toHaveBeenCalledTimes(1);
    expect(transcriber.transcribe).not.toHaveBeenCalled();
    // Never mislabeled as a payment/entitlement denial.
    const body = res.json() as { error?: string };
    expect(body.error).not.toBe("premium_required");
  });

  it("still denies a REAL entitlement decision with 403 premium_required (not conflated with the throw path)", async () => {
    const gate = denyGate("premium_required");
    const transcriber = fakeTranscriber();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: gate,
      transcriber,
    });

    const mp = multipartPayload([audioPart()]);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "premium_required" });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it("checks the gate with the authContext identity, ignoring body-injected tenant/tier", async () => {
    const gate = allowGate();
    const transcriber = fakeTranscriber();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: gate,
      transcriber,
    });

    const mp = multipartPayload([
      { field: "tenantId", data: "attacker-tenant" },
      { field: "tier", data: "pro" },
      audioPart(),
    ]);
    await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    // Identity is resolved ONLY from authContext — the spoofed fields are ignored.
    expect(gate.check).toHaveBeenCalledWith({ tenantId: TENANT_A, userId: USER_A });
  });

  // --- Happy path ----------------------------------------------------------

  it("Pro tenant with valid audio → 200 { text, unclear:false } from the transcriber", async () => {
    const transcriber = fakeTranscriber({ text: CANNED_TEXT, unclear: false });
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      transcriber,
    });

    const mp = multipartPayload([audioPart()]);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ text: CANNED_TEXT, unclear: false });
    expect(transcriber.transcribe).toHaveBeenCalledTimes(1);
    // The transcriber received the audio bytes + validated content type + a signal.
    const [inputArg, signalArg] = transcriber.transcribe.mock.calls[0]!;
    expect(inputArg.contentType).toBe("audio/webm");
    expect(inputArg.audio).toBeInstanceOf(Uint8Array);
    expect(inputArg.audio.byteLength).toBeGreaterThan(0);
    expect(signalArg).toBeInstanceOf(AbortSignal);
  });

  // --- Caps + allow-list (server-side, BEFORE OpenAI) ----------------------

  it("rejects oversize audio (>15MB) with 413 BEFORE any transcription", async () => {
    const transcriber = fakeTranscriber();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      transcriber,
    });

    // 16 MB payload — over the 15 MB cap.
    const big = Buffer.alloc(16 * 1024 * 1024, 0x61);
    const mp = multipartPayload([audioPart(big)]);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(413);
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it("rejects an unsupported content type with 415 BEFORE any transcription", async () => {
    const transcriber = fakeTranscriber();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      transcriber,
    });

    const mp = multipartPayload([
      { field: "audio", filename: "clip.txt", contentType: "text/plain", data: "not audio" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({ error: "unsupported_audio_format" });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it("drains a LARGE disallowed-content-type upload's unconsumed stream so the 415 arrives cleanly (no hang/reset)", async () => {
    // Review fix (resilience): `request.file()` only reads the part header —
    // the file stream itself is unconsumed at the point of the 415 decision.
    // Without draining it, a large disallowed-type upload leaves bytes
    // sitting on the socket, and the client can see an abrupt
    // ECONNRESET/EPIPE instead of the clean 415 response. Uses a REAL
    // listening socket (not `inject`, which never touches a real TCP
    // connection) so an un-drained stream would actually manifest as a
    // hang or a reset — proving the fix, not just the status code.
    const transcriber = fakeTranscriber();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      transcriber,
    });

    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("no listening port");
    const port = address.port;

    // 8 MB of disallowed-type "audio" — well past any stream highWaterMark,
    // so an un-drained stream would stall the writer/backpressure the socket.
    const big = Buffer.alloc(8 * 1024 * 1024, 0x62);
    const mp = multipartPayload([
      { field: "audio", filename: "clip.txt", contentType: "text/plain", data: big },
    ]);

    const response = await Promise.race([
      fetch(`http://127.0.0.1:${port}/plan-specs/transcribe`, {
        method: "POST",
        headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
        body: mp.body,
        duplex: "half",
      } as RequestInit),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("timed out — stream was not drained")), 5000),
      ),
    ]);

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "unsupported_audio_format" });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it("accepts every allow-listed content type", async () => {
    for (const contentType of [
      "audio/webm",
      "audio/mp4",
      "audio/x-m4a",
      "audio/m4a",
      "audio/mpeg",
      "audio/wav",
    ]) {
      const transcriber = fakeTranscriber();
      const localApp = await buildTestApp({
        db: buildSessionDb(),
        chatEntitlement: allowGate(),
        transcriber,
      });
      try {
        const mp = multipartPayload([
          { field: "audio", filename: "clip.bin", contentType, data: "audio-bytes" },
        ]);
        const res = await localApp.inject({
          method: "POST",
          url: "/plan-specs/transcribe",
          headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
          payload: mp.body,
        });
        expect(res.statusCode).toBe(200);
        expect(transcriber.transcribe).toHaveBeenCalledTimes(1);
      } finally {
        await localApp.close();
      }
    }
  });

  it("rejects a missing audio file part with 400 (no transcription)", async () => {
    const transcriber = fakeTranscriber();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      transcriber,
    });

    // Only a non-file field, no audio.
    const mp = multipartPayload([{ field: "note", data: "hello" }]);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(400);
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it("rejects an empty/zero-byte audio file with 400 (no transcription)", async () => {
    const transcriber = fakeTranscriber();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      transcriber,
    });

    const mp = multipartPayload([audioPart(Buffer.alloc(0))]);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(400);
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  // --- Fail-soft taxonomy --------------------------------------------------

  it("silence/unintelligible audio → 200 { text:'', unclear:true } (never a 5xx)", async () => {
    const transcriber = fakeTranscriber({ text: "", unclear: true });
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      transcriber,
    });

    const mp = multipartPayload([audioPart()]);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ text: "", unclear: true });
  });

  it("a transcriber transport failure → 502 generic, with NO stack/provider detail leaked", async () => {
    const transcriber = throwingTranscriber();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      transcriber,
    });

    const mp = multipartPayload([audioPart()]);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "transcription_failed" });
    // The provider's internal message/stack must not reach the client.
    expect(res.payload).not.toContain("secret-internal-stack-detail");
    expect(res.payload).not.toContain("OpenAI upstream 500");
  });

  it("a ProviderRateLimitError → 429 rate_limited with a DISTINCT warn log (not the generic 502 error log)", async () => {
    const transcriber = rateLimitedTranscriber();
    const logger = recordingLogger();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      transcriber,
      logger,
    });

    const mp = multipartPayload([audioPart()]);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: "rate_limited" });
    const dump = JSON.stringify(logger.records);
    expect(dump).toContain("provider rate limit / quota exceeded (HTTP 429) — request throttled");
    expect(dump).not.toContain("transcription failed");
  });

  // --- No persistence + no raw-audio/transcript logging --------------------

  it("NEVER persists: no repository write across success, unclear, and error paths", async () => {
    for (const result of [
      { transcriber: fakeTranscriber({ text: CANNED_TEXT, unclear: false }) },
      { transcriber: fakeTranscriber({ text: "", unclear: true }) },
      { transcriber: throwingTranscriber() },
    ]) {
      const repo = buildPlanRepo();
      const localApp = await buildTestApp({
        db: buildSessionDb(),
        repo,
        chatEntitlement: allowGate(),
        transcriber: result.transcriber,
      });
      try {
        const mp = multipartPayload([audioPart()]);
        await localApp.inject({
          method: "POST",
          url: "/plan-specs/transcribe",
          headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
          payload: mp.body,
        });

        // Zero writes to ANY repository method — the audio/transcript is in-flight only.
        expect(repo.upsertDraft).not.toHaveBeenCalled();
        expect(repo.promoteDraftToSpec).not.toHaveBeenCalled();
        expect(repo.findCurrentDraft).not.toHaveBeenCalled();
      } finally {
        await localApp.close();
      }
    }
  });

  it("never logs the raw audio bytes or the transcript text", async () => {
    const logger = recordingLogger();
    const uniqueAudio = "AUDIO-SENTINEL-3f9c-should-never-be-logged";
    const uniqueTranscript = "TRANSCRIPT-SENTINEL-should-never-be-logged";
    const transcriber = fakeTranscriber({ text: uniqueTranscript, unclear: false });
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      transcriber,
      logger,
    });

    const mp = multipartPayload([audioPart(uniqueAudio)]);
    await app.inject({
      method: "POST",
      url: "/plan-specs/transcribe",
      headers: { authorization: `Bearer ${VALID_TOKEN}`, ...mp.headers },
      payload: mp.body,
    });

    const dump = JSON.stringify(logger.records);
    expect(dump).not.toContain(uniqueAudio);
    expect(dump).not.toContain(uniqueTranscript);
  });
});
