import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkoutProgram } from "@kinora/contracts";
import { ResolvePrompt } from "../prompt-provider.js";
import type { LangfusePromptGateway } from "../prompt-source-port.js";
import { PLAN_PROMPT_TEMPLATE, buildPlanPrompt } from "../prompt.js";
import { redactTracedPayload } from "../trace-redaction.js";

// ---------------------------------------------------------------------------
// Mock @langchain/openai — hoisted before any import of production code
// ---------------------------------------------------------------------------
const mockInvoke = vi.fn();
const mockWithStructuredOutput = vi.fn(() => ({ invoke: mockInvoke }));
const MockChatOpenAI = vi.fn(() => ({
  withStructuredOutput: mockWithStructuredOutput,
}));
vi.mock("@langchain/openai", () => ({
  ChatOpenAI: MockChatOpenAI,
}));

const MockChatAnthropic = vi.fn(() => ({ withStructuredOutput: mockWithStructuredOutput }));
vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: MockChatAnthropic,
}));

const MockChatGoogleGenerativeAI = vi.fn(() => ({ withStructuredOutput: mockWithStructuredOutput }));
vi.mock("@langchain/google-genai", () => ({
  ChatGoogleGenerativeAI: MockChatGoogleGenerativeAI,
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------
const { buildAdapters } = await import("../adapter-factory.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const baseSpec = {
  goal: "strength" as const,
  daysPerWeek: 3,
  sessionDurationMinutes: 60,
  location: "gym" as const,
  equipment: ["barbell"],
  limitations: [],
  preferenceScores: { strength: 0.9, hypertrophy: 0.3, endurance: 0.2, mobility: 0.2 },
  confirmed: true,
};

const mockProgram: WorkoutProgram = {
  weeklySessions: [{ day: 1, title: "Day 1", exercises: [] }],
  limitationWarnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(mockProgram);
  delete process.env["LANGFUSE_BASEURL"];
  delete process.env["LANGFUSE_HOST"];
  delete process.env["LANGFUSE_PUBLIC_KEY"];
  delete process.env["LANGFUSE_SECRET_KEY"];
});

// ---------------------------------------------------------------------------
// opencode-go adapter — must use json_mode, NOT jsonSchema
// ---------------------------------------------------------------------------

describe("createOpenCodeGoAdapter (via buildAdapters)", () => {
  it("calls withStructuredOutput with method 'json_mode' (DeepSeek does not support jsonSchema)", async () => {
    const adapters = buildAdapters();
    const factory = adapters["opencode-go"];
    if (!factory) throw new Error("opencode-go adapter not registered");

    const adapter = factory("deepseek-v4-flash");
    await adapter.generate(baseSpec);

    // Must use jsonMode — jsonSchema causes a 400 from DeepSeek/OpenCode-Go
    expect(mockWithStructuredOutput).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "jsonMode" })
    );
  });

  it("does NOT use jsonSchema method for opencode-go (regression: 400 from DeepSeek)", async () => {
    const adapters = buildAdapters();
    const factory = adapters["opencode-go"]!;
    const adapter = factory("deepseek-v4-flash");
    await adapter.generate(baseSpec);

    const [, options] = mockWithStructuredOutput.mock.calls[0] as [unknown, { method?: string }];
    expect(options?.method).not.toBe("jsonSchema");
  });

  it("uses the model string passed to the factory", async () => {
    const adapters = buildAdapters();
    const factory = adapters["opencode-go"]!;
    factory("deepseek-v4-pro");

    const [, constructorArgs] = MockChatOpenAI.mock.calls[0] as [unknown, { model: string }];
    // ChatOpenAI is called with the model
    expect(MockChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ model: "deepseek-v4-pro" })
    );
  });
});

// ---------------------------------------------------------------------------
// Other adapters still use jsonSchema (sanity check)
// ---------------------------------------------------------------------------

describe("openrouter adapter still uses jsonSchema", () => {
  it("calls withStructuredOutput with method 'jsonSchema'", async () => {
    const adapters = buildAdapters();
    const factory = adapters["openrouter"]!;
    const adapter = factory("openai/gpt-4o-mini");
    await adapter.generate(baseSpec);

    expect(mockWithStructuredOutput).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "jsonSchema" })
    );
  });
});

// ---------------------------------------------------------------------------
// anthropic / google adapters — mirror the openrouter/openai coverage above.
// Both read their key from a provider-specific env var at call time and use
// jsonSchema structured output, same as openai/openrouter.
// ---------------------------------------------------------------------------

describe("createAnthropicAdapter (via buildAdapters)", () => {
  it("constructs ChatAnthropic with the model and reads ANTHROPIC_API_KEY at call time", async () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
    const adapters = buildAdapters();
    const factory = adapters["anthropic"];
    if (!factory) throw new Error("anthropic adapter not registered");

    const adapter = factory("claude-sonnet-test");
    await adapter.generate(baseSpec);

    expect(MockChatAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-ant-test", model: "claude-sonnet-test" })
    );
    delete process.env["ANTHROPIC_API_KEY"];
  });

  it("falls back to a placeholder key when ANTHROPIC_API_KEY is absent (does not throw at construction)", () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const adapters = buildAdapters();
    const factory = adapters["anthropic"]!;

    expect(() => factory("claude-sonnet-test")).not.toThrow();
    expect(MockChatAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "placeholder-key" })
    );
  });

  it("uses jsonSchema structured output and produces the parsed program via the shared invoke path", async () => {
    const adapters = buildAdapters();
    const adapter = adapters["anthropic"]!("claude-sonnet-test");

    const program = await adapter.generate(baseSpec);

    expect(mockWithStructuredOutput).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "jsonSchema" })
    );
    expect(program).toEqual(mockProgram);
    const config = mockInvoke.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(config).toEqual(
      expect.objectContaining({ metadata: expect.objectContaining({ provider: "anthropic", model: "claude-sonnet-test" }) })
    );
  });
});

describe("createGoogleAdapter (via buildAdapters)", () => {
  it("constructs ChatGoogleGenerativeAI with the model and reads GOOGLE_GENERATIVE_AI_API_KEY at call time", async () => {
    process.env["GOOGLE_GENERATIVE_AI_API_KEY"] = "gg-test-key";
    const adapters = buildAdapters();
    const factory = adapters["google"];
    if (!factory) throw new Error("google adapter not registered");

    const adapter = factory("gemini-test");
    await adapter.generate(baseSpec);

    expect(MockChatGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "gg-test-key", model: "gemini-test" })
    );
    delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  });

  it("falls back to a placeholder key when GOOGLE_GENERATIVE_AI_API_KEY is absent (does not throw at construction)", () => {
    delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
    const adapters = buildAdapters();
    const factory = adapters["google"]!;

    expect(() => factory("gemini-test")).not.toThrow();
    expect(MockChatGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "placeholder-key" })
    );
  });

  it("uses jsonSchema structured output and produces the parsed program via the shared invoke path", async () => {
    const adapters = buildAdapters();
    const adapter = adapters["google"]!("gemini-test");

    const program = await adapter.generate(baseSpec);

    expect(mockWithStructuredOutput).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "jsonSchema" })
    );
    expect(program).toEqual(mockProgram);
    const config = mockInvoke.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(config).toEqual(
      expect.objectContaining({ metadata: expect.objectContaining({ provider: "google", model: "gemini-test" }) })
    );
  });
});

describe("safe observability metadata", () => {
  it("passes non-sensitive run metadata to the LangChain invoke config", async () => {
    const adapters = buildAdapters();
    const adapter = adapters["openai"]!("gpt-4o-mini");
    await adapter.generate(baseSpec);

    const config = mockInvoke.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(config).toEqual(
      expect.objectContaining({
        runName: "plan-generation",
        metadata: expect.objectContaining({
          feature: "plan-generation",
          provider: "openai",
          model: "gpt-4o-mini",
        }),
      })
    );
  });

  it("attaches the injected tracing handler", async () => {
    const fakeHandler = { name: "langfuse", flushAsync: vi.fn() };
    const adapters = buildAdapters({ handler: fakeHandler });
    const adapter = adapters["openrouter"]!("openai/gpt-4o-mini");

    await adapter.generate(baseSpec);

    const config = mockInvoke.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(config).toEqual(
      expect.objectContaining({ callbacks: [fakeHandler] }),
    );
  });

  it("omits the callbacks key entirely when no handler is injected (byte-identical no-handler config)", async () => {
    const adapters = buildAdapters();
    const adapter = adapters["openrouter"]!("openai/gpt-4o-mini");

    await adapter.generate(baseSpec);

    const config = mockInvoke.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(config).not.toHaveProperty("callbacks");
  });
});

describe("masking invariant on trace payloads", () => {
  it("masks a known limitation in the invoke input and it never reaches the resolved program via JSON.stringify", async () => {
    const adapters = buildAdapters();
    const adapter = adapters["openai"]!("gpt-4o-mini");

    const specWithLimitation = {
      ...baseSpec,
      limitations: [{ text: "osteoporosis", isWarning: true }],
    };

    const resolvedProgram = await adapter.generate(specWithLimitation);

    const invokeInput = mockInvoke.mock.calls[0]?.[0] as string;
    expect(invokeInput).toContain("[REDACTED]");
    expect(invokeInput).not.toContain("osteoporosis");
    expect(JSON.stringify([invokeInput, resolvedProgram])).not.toContain("osteoporosis");
  });
});

describe("trace redaction (17c-profile-body-metrics, PR 3) — model/trace divergence", () => {
  it("the model receives the raw bodyweight, while the SAME text redacted by the real mask hook does not", async () => {
    // This is the proof that matters: it does not fabricate a fake handler
    // that happens to observe nothing (this file's fake handler is just
    // `{ name, flushAsync }` — it never intercepts anything, exactly like
    // production when tracing is off). Instead it proves the COMPOSITION the
    // real CallbackHandler relies on: `langfuse-handler.test.ts` proves
    // `redactTracedPayload` is wired as the `mask` option on every
    // constructed handler; `trace-redaction.test.ts` proves what that
    // function does to a string. This test proves the invoke input — the
    // EXACT string a real handler would observe and mask — contains the raw
    // value for the model, while applying the same masking function that
    // real handler is configured with removes it.
    const adapters = buildAdapters();
    const adapter = adapters["openai"]!("gpt-4o-mini");

    await adapter.generate({
      ...baseSpec,
      bodyProfile: { selfDescribedSex: "female", heightCm: 172, bodyweightKg: 68 },
    });

    const invokeInput = mockInvoke.mock.calls[0]?.[0] as string;

    // Half 1 — the model still gets it (scope B's entire point).
    expect(invokeInput).toContain("68 kg");
    expect(invokeInput).toContain("172 cm");
    expect(invokeInput).toContain("<body_profile>");

    // Half 2 — the exact same string, run through the production mask
    // function, no longer carries it. Asserting only this half would pass
    // for a change that accidentally ALSO stripped the values from
    // generation — asserting only half 1 would pass for a change that never
    // redacted the trace at all. Both must hold.
    const tracedInput = redactTracedPayload({ data: invokeInput }) as string;
    expect(tracedInput).not.toContain("68 kg");
    expect(tracedInput).not.toContain("172 cm");
    expect(tracedInput).toContain("<body_profile>[REDACTED]</body_profile>");
  });

  it("omits the <body_profile> section entirely (nothing to redact) when no body values are present", async () => {
    const adapters = buildAdapters();
    const adapter = adapters["openai"]!("gpt-4o-mini");

    await adapter.generate(baseSpec);

    const invokeInput = mockInvoke.mock.calls[0]?.[0] as string;
    expect(invokeInput).not.toContain("body_profile");
  });
});

describe("promptLinked is unaffected by the redaction mask (17c-profile-body-metrics, PR 3.9)", () => {
  it("promptLinked is IDENTICAL with and without a body profile attached, handler present either way", async () => {
    // `registerLangfusePrompt` operates on run parenting (the reparented
    // chain from `linkStructuredChain`'s shape guard), never on `input`/
    // `output` bytes — the two mechanisms SHOULD be orthogonal. Asserted
    // here rather than assumed, by comparing the value across the one thing
    // this change adds: a body profile on the spec. A real
    // `CallbackHandler` built via `buildLangfuseCallbackHandler` ALWAYS
    // carries `mask: redactTracedPayload` (see langfuse-handler.test.ts), so
    // any handler this adapter receives in production has it — this fake
    // handler stands in for that handler at the injection seam.
    //
    // This file's mocked `withStructuredOutput` returns a plain object, not
    // a real `RunnableSequence` (see `prompt-linked-chain.test.ts` for a
    // fixture that IS one) — so the shape guard declines and `promptLinked`
    // is `false` in every test in this file (see the "attaches promptLinked
    // and NO promptName…" test above). The value that matters for THIS
    // assertion is not which boolean it is, but that it is the SAME boolean
    // with a body profile present as without one.
    const fakeHandler = { name: "langfuse", flushAsync: vi.fn() };
    const adapters = buildAdapters({ handler: fakeHandler });
    const adapter = adapters["openai"]!("gpt-4o-mini");

    await adapter.generate(baseSpec);
    const withoutBodyProfile = (mockInvoke.mock.calls[0]?.[1] as Record<string, unknown>)
      .metadata as Record<string, unknown>;

    mockInvoke.mockClear();
    await adapter.generate({ ...baseSpec, bodyProfile: { bodyweightKg: 68 } });
    const withBodyProfile = (mockInvoke.mock.calls[0]?.[1] as Record<string, unknown>)
      .metadata as Record<string, unknown>;

    expect(withBodyProfile["promptLinked"]).toBe(withoutBodyProfile["promptLinked"]);
    expect(withBodyProfile["promptLinked"]).toBe(false);
  });
});

describe("prompt-source attribution (langfuse-prompt-management, slice B2)", () => {
  it("attaches promptSource: fallback and uses the local template when no prompts dep is injected", async () => {
    const adapters = buildAdapters();
    const adapter = adapters["openai"]!("gpt-4o-mini");

    await adapter.generate(baseSpec);

    const config = mockInvoke.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(config).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ promptSource: "fallback" }),
      })
    );
    const invokeInput = mockInvoke.mock.calls[0]?.[0] as string;
    expect(invokeInput).toBe(buildPlanPrompt(baseSpec));
  });

  it("resolves the prompt through deps.prompts and attaches promptSource: langfuse on a successful remote fetch", async () => {
    const gateway: LangfusePromptGateway = {
      fetchPrompt: vi.fn(async () => ({ template: PLAN_PROMPT_TEMPLATE, version: 5 })),
    };
    const prompts = new ResolvePrompt(gateway);
    const adapters = buildAdapters({ prompts });
    const adapter = adapters["openai"]!("gpt-4o-mini");

    await adapter.generate(baseSpec);

    const config = mockInvoke.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(config).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ promptSource: "langfuse" }),
      })
    );
    // The remote template is byte-identical to the local one and there are
    // no limitations to mask, so the rendered/invoked text is unchanged.
    const invokeInput = mockInvoke.mock.calls[0]?.[0] as string;
    expect(invokeInput).toBe(buildPlanPrompt(baseSpec));
  });

  it("plan generation succeeds with the LOCAL template when a real ResolvePrompt is wired but no Langfuse credentials are configured (production no-credentials shape)", async () => {
    // Mirrors app.ts's actual production wiring: a real ResolvePrompt instance
    // is ALWAYS constructed and injected via deps.prompts, but its gateway is
    // null when LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY are absent
    // (buildLangfusePromptGateway() returns null). This is the exact shape
    // the proposal's non-negotiable protects: an unreachable/absent prompt
    // service must never fail a generation.
    const prompts = new ResolvePrompt(null);
    const adapters = buildAdapters({ prompts });
    const adapter = adapters["openai"]!("gpt-4o-mini");

    const program = await adapter.generate(baseSpec);

    expect(program).toEqual(mockProgram);
    const config = mockInvoke.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(config).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ promptSource: "fallback" }),
      })
    );
    const invokeInput = mockInvoke.mock.calls[0]?.[0] as string;
    expect(invokeInput).toBe(buildPlanPrompt(baseSpec));
  });
});

describe("native prompt-version linkage attribution (slice C)", () => {
  it("attaches promptName, promptVersion, promptLabel and langfusePrompt when the prompt came from Langfuse", async () => {
    const gateway: LangfusePromptGateway = {
      fetchPrompt: vi.fn(async () => ({ template: PLAN_PROMPT_TEMPLATE, version: 7 })),
    };
    const prompts = new ResolvePrompt(gateway);
    const adapters = buildAdapters({ prompts });
    const adapter = adapters["openai"]!("gpt-4o-mini");

    await adapter.generate(baseSpec);

    const config = mockInvoke.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(config).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          promptSource: "langfuse",
          promptName: "kinora-plan-generation",
          promptVersion: 7,
          promptLabel: "production",
          langfusePrompt: { name: "kinora-plan-generation", version: 7, isFallback: false },
        }),
      })
    );
  });

  it("attaches promptLinked and NO promptName/promptVersion/langfusePrompt key on the fallback path", async () => {
    const adapters = buildAdapters();
    const adapter = adapters["openai"]!("gpt-4o-mini");

    await adapter.generate(baseSpec);

    const config = mockInvoke.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    const metadata = config?.metadata as Record<string, unknown>;
    expect(metadata["promptSource"]).toBe("fallback");
    expect(metadata).toHaveProperty("promptLinked");
    expect(metadata).not.toHaveProperty("promptName");
    expect(metadata).not.toHaveProperty("promptVersion");
    expect(metadata).not.toHaveProperty("promptLabel");
    expect(metadata).not.toHaveProperty("langfusePrompt");
  });

  it("promptLinked is false here because the mocked withStructuredOutput chain in this test file is a plain object, not a real RunnableSequence, so the shape guard declines — generation still succeeds", async () => {
    const adapters = buildAdapters();
    const adapter = adapters["openai"]!("gpt-4o-mini");

    const program = await adapter.generate(baseSpec);

    expect(program).toEqual(mockProgram);
    const config = mockInvoke.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    const metadata = config?.metadata as Record<string, unknown>;
    expect(metadata["promptLinked"]).toBe(false);
  });
});
