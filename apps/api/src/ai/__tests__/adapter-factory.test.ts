import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkoutProgram } from "@kinora/contracts";

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
