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
const mockFlushAsync = vi.fn();

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: MockChatOpenAI,
}));

vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: vi.fn(() => ({ withStructuredOutput: mockWithStructuredOutput })),
}));

vi.mock("@langchain/google-genai", () => ({
  ChatGoogleGenerativeAI: vi.fn(() => ({ withStructuredOutput: mockWithStructuredOutput })),
}));

const MockCallbackHandler = vi.fn(() => ({ flushAsync: mockFlushAsync }));
vi.mock("langfuse-langchain", () => ({
  CallbackHandler: MockCallbackHandler,
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

describe("Langfuse observability", () => {
  it("maps LANGFUSE_HOST to LANGFUSE_BASEURL before constructing the callback handler", async () => {
    process.env["LANGFUSE_HOST"] = "https://langfuse.example.test";

    const adapters = buildAdapters();
    const adapter = adapters["openrouter"]!("openai/gpt-4o-mini");
    await adapter.generate(baseSpec);

    expect(process.env["LANGFUSE_BASEURL"]).toBe("https://langfuse.example.test");
    expect(MockCallbackHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ["plan-generation"],
        metadata: expect.objectContaining({
          feature: "plan-generation",
          provider: "openrouter",
          model: "openai/gpt-4o-mini",
        }),
      })
    );
  });

  it("does not overwrite LANGFUSE_BASEURL when both Langfuse URL env vars are set", async () => {
    process.env["LANGFUSE_BASEURL"] = "https://canonical-langfuse.example.test";
    process.env["LANGFUSE_HOST"] = "https://legacy-langfuse.example.test";

    const adapters = buildAdapters();
    const adapter = adapters["openrouter"]!("openai/gpt-4o-mini");
    await adapter.generate(baseSpec);

    expect(process.env["LANGFUSE_BASEURL"]).toBe("https://canonical-langfuse.example.test");
  });

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

  it("flushes the Langfuse handler after a successful invoke", async () => {
    const adapters = buildAdapters();
    const adapter = adapters["openrouter"]!("openai/gpt-4o-mini");
    await adapter.generate(baseSpec);

    expect(mockFlushAsync).toHaveBeenCalledTimes(1);
  });

  it("flushes the Langfuse handler when the LLM invoke fails", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("llm failed"));

    const adapters = buildAdapters();
    const adapter = adapters["openrouter"]!("openai/gpt-4o-mini");

    await expect(adapter.generate(baseSpec)).rejects.toThrow("llm failed");
    expect(mockFlushAsync).toHaveBeenCalledTimes(1);
  });
});
