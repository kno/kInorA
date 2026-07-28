import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "../../auth/plugin.js";
import { planRoutes, type PlanRouteRepo, type VoicePreferenceReader } from "../plan.js";
import type { ChatEntitlementPort } from "../../billing/chat-entitlement.js";
import type {
  SpeechSynthesizer,
  SynthesizeResult,
} from "../../ai/speech-synthesizer-port.js";
import { OpenAIAudioAdapter, type OpenAIAudioClient } from "../../ai/openai-audio-adapter.js";
import { ProviderRateLimitError } from "../../ai/provider-errors.js";
import type { Database } from "../../db/client.js";
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

function allowGate(): ChatEntitlementPort & { check: ReturnType<typeof vi.fn> } {
  return { check: vi.fn().mockResolvedValue({ allowed: true }) };
}

function denyGate(reason = "premium_required"): ChatEntitlementPort & {
  check: ReturnType<typeof vi.fn>;
} {
  return { check: vi.fn().mockResolvedValue({ allowed: false, reason }) };
}

function throwingGate(): ChatEntitlementPort & { check: ReturnType<typeof vi.fn> } {
  return { check: vi.fn().mockRejectedValue(new Error("entitlement reader down")) };
}

const MOCK_AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04]);

/** Deterministic synthesizer double; records how it was called. */
function fakeSynthesizer(
  result: SynthesizeResult = { audio: MOCK_AUDIO, contentType: "audio/mpeg" },
): SpeechSynthesizer & { synthesize: ReturnType<typeof vi.fn> } {
  return {
    synthesize: vi.fn(
      (_text: string, _signal?: AbortSignal): Promise<SynthesizeResult> =>
        Promise.resolve(result),
    ),
  };
}

/** Synthesizer that rejects with a provider transport error (stack must NOT leak). */
function throwingSynthesizer(): SpeechSynthesizer & { synthesize: ReturnType<typeof vi.fn> } {
  return {
    synthesize: vi.fn().mockRejectedValue(
      new Error("OpenAI TTS upstream 500 — secret-internal-stack-detail"),
    ),
  };
}

/** Synthesizer that rejects with a rate-limit/quota-exhausted failure. */
function rateLimitedSynthesizer(): SpeechSynthesizer & { synthesize: ReturnType<typeof vi.fn> } {
  return {
    synthesize: vi.fn().mockRejectedValue(new ProviderRateLimitError("gemini", "tts")),
  };
}

/** TTS preference reader double returning a configured flag. */
function prefsReader(ttsEnabled: boolean | null): VoicePreferenceReader & {
  findTtsEnabled: ReturnType<typeof vi.fn>;
} {
  return { findTtsEnabled: vi.fn().mockResolvedValue(ttsEnabled) };
}

/** A recording logger so tests can assert text/key are NEVER logged. */
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

async function buildTestApp(opts: {
  db: Database;
  repo?: PlanRepoMock;
  chatEntitlement: ChatEntitlementPort;
  synthesizer?: SpeechSynthesizer;
  voicePreferences?: VoicePreferenceReader;
  logger?: ReturnType<typeof recordingLogger>;
}): Promise<FastifyInstance> {
  // In production `buildApp()` runs with logging OFF (`Fastify()` default), so
  // Fastify never serializes request/response bodies. When a recording logger is
  // injected we disable Fastify's automatic req/res logging too, so the test
  // captures ONLY the route's own explicit log calls — the surface the
  // no-text-leak requirement actually governs.
  const app = Fastify(
    opts.logger
      ? { loggerInstance: opts.logger as never, disableRequestLogging: true }
      : {},
  );
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
    synthesizer: opts.synthesizer,
    voicePreferences: opts.voicePreferences ?? prefsReader(null),
  });
  return app;
}

const CANNED_TEXT = "great — four days a week with dumbbells, let's build it.";

// --- Tests -----------------------------------------------------------------

describe("POST /plan-specs/speech (Pro-gated, opt-out-aware, no-persistence TTS)", () => {
  let app: FastifyInstance | undefined;

  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 401 when unauthenticated (no synthesize call)", async () => {
    const synthesizer = fakeSynthesizer();
    app = await buildTestApp({
      db: { select: sessionSelectChain([]) } as unknown as Database,
      chatEntitlement: allowGate(),
      synthesizer,
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/speech",
      payload: { text: CANNED_TEXT },
    });

    expect(res.statusCode).toBe(401);
    expect(synthesizer.synthesize).not.toHaveBeenCalled();
  });

  it("denies a Free tenant with 403 premium_required BEFORE any synthesis", async () => {
    const gate = denyGate("premium_required");
    const synthesizer = fakeSynthesizer();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: gate,
      synthesizer,
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/speech",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { text: CANNED_TEXT },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "premium_required" });
    expect(gate.check).toHaveBeenCalledTimes(1);
    expect(synthesizer.synthesize).not.toHaveBeenCalled();
  });

  it("propagates the entitlement lapse reason on denial (expired trial → 403)", async () => {
    const gate = denyGate("trial_expired");
    const synthesizer = fakeSynthesizer();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: gate,
      synthesizer,
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/speech",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { text: CANNED_TEXT },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "trial_expired" });
    expect(synthesizer.synthesize).not.toHaveBeenCalled();
  });

  it("fails CLOSED (synthesizer never reached) when the gate check THROWS, surfaced as a 5xx — NOT premium_required", async () => {
    const gate = throwingGate();
    const synthesizer = fakeSynthesizer();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: gate,
      synthesizer,
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/speech",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { text: CANNED_TEXT },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.statusCode).toBeLessThan(600);
    expect(gate.check).toHaveBeenCalledTimes(1);
    expect(synthesizer.synthesize).not.toHaveBeenCalled();
    const body = res.json() as { error?: string };
    expect(body.error).not.toBe("premium_required");
  });

  it("checks the gate with the authContext identity, ignoring body-injected tenant/tier", async () => {
    const gate = allowGate();
    const synthesizer = fakeSynthesizer();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: gate,
      synthesizer,
    });

    await app.inject({
      method: "POST",
      url: "/plan-specs/speech",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { text: CANNED_TEXT, tenantId: "attacker-tenant", tier: "pro" },
    });

    expect(gate.check).toHaveBeenCalledWith({ tenantId: TENANT_A, userId: USER_A });
  });

  // --- Happy path (opt-out default ON) -------------------------------------

  it("Pro tenant with ttsEnabled=null → 200 audio/mpeg from the synthesizer (called once)", async () => {
    const synthesizer = fakeSynthesizer();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      synthesizer,
      voicePreferences: prefsReader(null),
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/speech",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { text: CANNED_TEXT },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("audio/mpeg");
    expect(synthesizer.synthesize).toHaveBeenCalledTimes(1);
    expect(Buffer.from(res.rawPayload).equals(Buffer.from(MOCK_AUDIO))).toBe(true);
    const [textArg, signalArg] = synthesizer.synthesize.mock.calls[0]!;
    expect(textArg).toBe(CANNED_TEXT);
    expect(signalArg).toBeInstanceOf(AbortSignal);
  });

  it("Pro tenant with ttsEnabled=true → 200 audio/mpeg", async () => {
    const synthesizer = fakeSynthesizer();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      synthesizer,
      voicePreferences: prefsReader(true),
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/speech",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { text: CANNED_TEXT },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("audio/mpeg");
    expect(synthesizer.synthesize).toHaveBeenCalledTimes(1);
  });

  // --- Opt-out ------------------------------------------------------------

  it("Pro tenant with ttsEnabled=false → 204 No Content and the synthesizer is NEVER called", async () => {
    const synthesizer = fakeSynthesizer();
    const prefs = prefsReader(false);
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      synthesizer,
      voicePreferences: prefs,
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/speech",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { text: CANNED_TEXT },
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(prefs.findTtsEnabled).toHaveBeenCalledWith(USER_A);
    expect(synthesizer.synthesize).not.toHaveBeenCalled();
  });

  // --- Input cap (truncation is the SYNTHESIZER's responsibility) ----------
  //
  // Review fix: the route previously did `text.slice(0, 4096)` BEFORE calling
  // the synthesizer, making the adapter's sentence-boundary truncation
  // unreachable dead code and cutting replies mid-word. The route now forwards
  // the raw (schema-length-bounded) text UNCHANGED — `SpeechSynthesizer` (the
  // real `OpenAIAudioAdapter`) is the single source of truth for the
  // ~4096-char OpenAI cap and its sentence-boundary cut.

  it("forwards over-length text to the synthesizer UNCHANGED — the route does NOT pre-truncate", async () => {
    const synthesizer = fakeSynthesizer();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      synthesizer,
    });

    const longText = "a".repeat(8000);
    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/speech",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { text: longText },
    });

    expect(res.statusCode).toBe(200);
    expect(synthesizer.synthesize).toHaveBeenCalledTimes(1);
    const [textArg] = synthesizer.synthesize.mock.calls[0]!;
    // Full 8000 chars reach the port — truncation happens INSIDE the real
    // adapter, never at the route boundary.
    expect(textArg).toBe(longText);
  });

  it("end-to-end (route + REAL OpenAIAudioAdapter): a >4096-char multi-sentence reply is truncated at a SENTENCE BOUNDARY, not mid-word — fails against a route-level mid-word slice", async () => {
    // A fake OpenAI-audio client (no network) whose speech.create records the
    // exact `input` the adapter sent it — this is the byte that would have
    // been a mid-word cut under the old buggy route (`text.slice(0, 4096)`
    // performed BEFORE the adapter ever saw the text).
    const speechCalls: Array<{ input: string }> = [];
    const fakeOpenAIClient: OpenAIAudioClient = {
      audio: {
        transcriptions: { create: vi.fn(async () => ({ text: "" })) },
        speech: {
          create: vi.fn(async (body: { input: string }) => {
            speechCalls.push({ input: body.input });
            return {
              arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
            };
          }),
        },
      },
    };
    const realAdapter = new OpenAIAudioAdapter(() => fakeOpenAIClient);

    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      synthesizer: realAdapter,
    });

    // Build text where the LAST sentence boundary before char 4096 lands well
    // before the 4096 mark, so a naive mid-word `slice(0, 4096)` would NOT
    // end on `.`/`!`/`?` — proving the boundary-vs-mid-word distinction.
    const sentence = "kInorA replies with a full training sentence here. ";
    const longMultiSentence = sentence.repeat(120); // > 4096 chars, many sentences
    expect(longMultiSentence.length).toBeGreaterThan(4096);

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/speech",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { text: longMultiSentence },
    });

    expect(res.statusCode).toBe(200);
    expect(speechCalls).toHaveLength(1);
    const sent = speechCalls[0]!.input;
    expect(sent.length).toBeLessThanOrEqual(4096);
    // The forwarded text ends at a sentence boundary (`.`), never mid-word —
    // this assertion FAILS if the route reintroduces a mid-word
    // `slice(0, 4096)` ahead of the synthesizer call, because a raw character
    // slice of this repeating sentence lands mid-word, not on the period.
    expect(sent.trimEnd().endsWith(".")).toBe(true);
    // And it is NOT simply the naive mid-word slice of the full text.
    expect(sent).not.toBe(longMultiSentence.slice(0, 4096));
  });

  // --- Fail-soft taxonomy --------------------------------------------------

  it("a synthesizer transport failure → 502 generic, with NO stack/provider detail leaked", async () => {
    const synthesizer = throwingSynthesizer();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      synthesizer,
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/speech",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { text: CANNED_TEXT },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "synthesis_failed" });
    expect(res.payload).not.toContain("secret-internal-stack-detail");
    expect(res.payload).not.toContain("OpenAI TTS upstream 500");
  });

  it("a ProviderRateLimitError → 429 rate_limited with a DISTINCT warn log (not the generic 502 error log)", async () => {
    const synthesizer = rateLimitedSynthesizer();
    const logger = recordingLogger();
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      synthesizer,
      logger,
    });

    const res = await app.inject({
      method: "POST",
      url: "/plan-specs/speech",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { text: CANNED_TEXT },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: "rate_limited" });
    const dump = JSON.stringify(logger.records);
    expect(dump).toContain("provider rate limit / quota exceeded (HTTP 429) — request throttled");
    expect(dump).not.toContain("synthesis failed");
  });

  // --- No persistence + no text/key logging --------------------------------

  it("NEVER persists: no repository write across success, opt-out, and error paths", async () => {
    for (const scenario of [
      { synthesizer: fakeSynthesizer(), prefs: prefsReader(null) },
      { synthesizer: fakeSynthesizer(), prefs: prefsReader(false) },
      { synthesizer: throwingSynthesizer(), prefs: prefsReader(true) },
    ]) {
      const repo = buildPlanRepo();
      const localApp = await buildTestApp({
        db: buildSessionDb(),
        repo,
        chatEntitlement: allowGate(),
        synthesizer: scenario.synthesizer,
        voicePreferences: scenario.prefs,
      });
      try {
        await localApp.inject({
          method: "POST",
          url: "/plan-specs/speech",
          headers: { authorization: `Bearer ${VALID_TOKEN}` },
          payload: { text: CANNED_TEXT },
        });
        expect(repo.upsertDraft).not.toHaveBeenCalled();
        expect(repo.promoteDraftToSpec).not.toHaveBeenCalled();
        expect(repo.findCurrentDraft).not.toHaveBeenCalled();
      } finally {
        await localApp.close();
      }
    }
  });

  it("never logs the input text", async () => {
    const logger = recordingLogger();
    const uniqueText = "TEXT-SENTINEL-should-never-be-logged-3f9c";
    const synthesizer = throwingSynthesizer(); // error path logs — assert text absent
    app = await buildTestApp({
      db: buildSessionDb(),
      chatEntitlement: allowGate(),
      synthesizer,
      logger,
    });

    await app.inject({
      method: "POST",
      url: "/plan-specs/speech",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
      payload: { text: uniqueText },
    });

    const dump = JSON.stringify(logger.records);
    expect(dump).not.toContain(uniqueText);
  });
});
