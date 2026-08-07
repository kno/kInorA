import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkoutProgram } from "@kinora/contracts";
import { ResolvePrompt } from "../prompt-provider.js";
import type { LangfusePromptGateway } from "../prompt-source-port.js";
import { PLAN_PROMPT_TEMPLATE, buildPlanPrompt } from "../prompt.js";

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

vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: vi.fn(() => ({ withStructuredOutput: mockWithStructuredOutput })),
}));

vi.mock("@langchain/google-genai", () => ({
  ChatGoogleGenerativeAI: vi.fn(() => ({ withStructuredOutput: mockWithStructuredOutput })),
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
