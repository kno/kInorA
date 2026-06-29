import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlanSpec, WorkoutProgram } from "@kinora/contracts";

// ---------------------------------------------------------------------------
// Mock @langchain/openai — must be hoisted before any import of production code
// ---------------------------------------------------------------------------
const mockInvoke = vi.fn();
const mockWithStructuredOutput = vi.fn(() => ({ invoke: mockInvoke }));
const MockChatOpenAI = vi.fn(() => ({
  withStructuredOutput: mockWithStructuredOutput,
}));

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: MockChatOpenAI,
}));

// Mock langfuse-langchain CallbackHandler
const MockCallbackHandler = vi.fn(() => ({}));
vi.mock("langfuse-langchain", () => ({
  CallbackHandler: MockCallbackHandler,
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks are registered
// ---------------------------------------------------------------------------
const { OpenRouterPlanGenerator } = await import("../openrouter-generator.js");

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const baseSpec: PlanSpec = {
  goal: "hypertrophy",
  daysPerWeek: 3,
  sessionDurationMinutes: 60,
  location: "gym",
  equipment: ["barbell", "dumbbells"],
  limitations: [
    { text: "knee pain", isWarning: true },
    { text: "lower back pain", isWarning: true },
  ],
  preferenceScores: {
    strength: 0.3,
    hypertrophy: 0.9,
    endurance: 0.2,
    mobility: 0.4,
  },
  confirmed: true,
};

const mockProgram: WorkoutProgram = {
  weeklySessions: [
    {
      day: 1,
      title: "Push Day",
      exercises: [
        { name: "Bench Press", sets: 4, reps: "8-12", restSeconds: 90 },
      ],
    },
  ],
  limitationWarnings: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("OpenRouterPlanGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(mockProgram);
  });

  describe("construction", () => {
    it("is constructable without OPENROUTER_API_KEY set", () => {
      // No key in environment — must not throw on instantiation
      delete process.env["OPENROUTER_API_KEY"];
      expect(() => new OpenRouterPlanGenerator()).not.toThrow();
    });

    it("is constructable when OPENROUTER_API_KEY is set", () => {
      process.env["OPENROUTER_API_KEY"] = "sk-test-key";
      expect(() => new OpenRouterPlanGenerator()).not.toThrow();
      delete process.env["OPENROUTER_API_KEY"];
    });

    it("wires ChatOpenAI with the OpenRouter base URL", () => {
      new OpenRouterPlanGenerator();
      expect(MockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          configuration: expect.objectContaining({
            baseURL: "https://openrouter.ai/api/v1",
          }),
        })
      );
    });

    it("sets X-Title header to kInorA", () => {
      new OpenRouterPlanGenerator();
      expect(MockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          configuration: expect.objectContaining({
            defaultHeaders: expect.objectContaining({
              "X-Title": "kInorA",
            }),
          }),
        })
      );
    });

    // Fix 2 (HIGH): lock the method option — expect.anything() was too loose
    it("calls withStructuredOutput with method: jsonSchema", () => {
      new OpenRouterPlanGenerator();
      expect(mockWithStructuredOutput).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: "jsonSchema" })
      );
    });
  });

  describe("mask — limitation text must NOT reach Langfuse trace", () => {
    it("invokes the chain with masked limitation text in the prompt input", async () => {
      const generator = new OpenRouterPlanGenerator();
      await generator.generate(baseSpec);

      // The invoke call must have been made
      expect(mockInvoke).toHaveBeenCalled();

      // The first argument to invoke is the prompt string
      const invokeArgs = mockInvoke.mock.calls[0];
      const promptArg = invokeArgs?.[0] as string | undefined;
      expect(typeof promptArg).toBe("string");

      // Raw limitation text MUST NOT appear in the string that LangChain
      // (and therefore Langfuse via the callback) sees
      expect(promptArg).not.toContain("knee pain");
      expect(promptArg).not.toContain("lower back pain");
      // The redaction placeholder should appear instead
      expect(promptArg).toContain("[REDACTED]");
    });

    it("leaves prompt intact when spec has no limitations", async () => {
      const specNoLimitations: PlanSpec = {
        ...baseSpec,
        limitations: [],
      };
      const generator = new OpenRouterPlanGenerator();
      await generator.generate(specNoLimitations);

      const invokeArgs = mockInvoke.mock.calls[0];
      const promptArg = invokeArgs?.[0] as string | undefined;
      // No [REDACTED] when there are no limitations
      expect(promptArg).not.toContain("[REDACTED]");
    });
  });

  describe("Langfuse CallbackHandler wiring", () => {
    it("instantiates a CallbackHandler for observability", () => {
      new OpenRouterPlanGenerator();
      expect(MockCallbackHandler).toHaveBeenCalled();
    });

    it("passes the callback to invoke via callbacks config", async () => {
      const generator = new OpenRouterPlanGenerator();
      await generator.generate(baseSpec);

      const invokeArgs = mockInvoke.mock.calls[0];
      // Second argument is the RunnableConfig with callbacks
      const config = invokeArgs?.[1] as Record<string, unknown> | undefined;
      expect(config).toBeDefined();
      expect(Array.isArray(config?.callbacks)).toBe(true);
    });

    // Fix 3 (MEDIUM): assert the actual CallbackHandler instance is at index 0.
    // vi.fn(() => ({})) uses a factory that returns an explicit object, so
    // mock.results[0].value is the returned handler instance (what langfuseHandler
    // holds), while mock.instances[0] would be the raw 'this' context — different
    // objects. We assert the RETURNED value, which is what production code uses.
    it("wires the specific CallbackHandler instance as callbacks[0]", async () => {
      const generator = new OpenRouterPlanGenerator();
      await generator.generate(baseSpec);

      const invokeArgs = mockInvoke.mock.calls[0];
      const config = invokeArgs?.[1] as Record<string, unknown> | undefined;
      const callbacks = config?.callbacks as unknown[] | undefined;
      // Must be the exact instance the constructor created — not an empty array
      // or a different object. Changing to `callbacks: []` would break this test.
      const handlerInstance = MockCallbackHandler.mock.results[0]?.value as unknown;
      expect(callbacks?.[0]).toBe(handlerInstance);
    });
  });

  describe("generate — output contract", () => {
    it("returns a WorkoutProgram matching the mock response", async () => {
      const generator = new OpenRouterPlanGenerator();
      const result = await generator.generate(baseSpec);

      expect(result.weeklySessions).toHaveLength(1);
      expect(result.weeklySessions[0]?.day).toBe(1);
      expect(result.weeklySessions[0]?.title).toBe("Push Day");
      expect(result.weeklySessions[0]?.exercises[0]?.name).toBe("Bench Press");
    });

    it("propagates errors thrown by the LLM chain", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("API timeout"));
      const generator = new OpenRouterPlanGenerator();
      await expect(generator.generate(baseSpec)).rejects.toThrow("API timeout");
    });

    // Fix 1 (HIGH): explicit Zod validation — malformed model output must throw
    // rather than silently returning garbage into the domain pipeline.
    it("throws a ZodError when the LLM returns malformed output", async () => {
      // Mock chain returns an object that does NOT match WorkoutProgramSchema
      mockInvoke.mockResolvedValueOnce({ weeklySessions: null });
      const generator = new OpenRouterPlanGenerator();
      // generate() must reject — the bare cast `result as WorkoutProgram`
      // would silently pass; WorkoutProgramSchema.parse() throws ZodError
      await expect(generator.generate(baseSpec)).rejects.toThrow();
    });
  });
});
