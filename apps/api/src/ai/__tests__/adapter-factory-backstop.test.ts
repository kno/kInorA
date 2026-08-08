import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkoutProgram } from "@kinora/contracts";
import type { LangfusePromptGateway } from "../prompt-source-port.js";

/**
 * The fail-closed backstop (17c-profile-body-metrics, PR 3 — see design.md
 * "The fail-closed backstop"). `trace-redaction.test.ts` proves
 * `isRedactionVerified` itself is correct in isolation. This file proves the
 * WIRING: `invokeChain` (`adapter-factory.ts`) actually calls it and actually
 * degrades when it fails, rather than assuming the pure function is enough
 * on its own.
 *
 * `buildPlanPromptVariables` always renders `<body_profile>` delimiters
 * around the section it builds — there is no natural way to trigger a
 * marker-less rendering through the real renderer. This file mocks
 * `./prompt.js` to simulate exactly that: a `bodyProfileSection` that
 * contains the distinctive inner text WITHOUT the wrapping delimiters, as a
 * future bug or a corrupted remote template might produce. This mock is
 * isolated to this file's own module graph — it does not affect
 * `prompt.test.ts` or `adapter-factory.test.ts`.
 */

const mockInvoke = vi.fn();
const mockWithStructuredOutput = vi.fn(() => ({ invoke: mockInvoke }));
vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn(() => ({ withStructuredOutput: mockWithStructuredOutput })),
}));
vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: vi.fn(() => ({ withStructuredOutput: mockWithStructuredOutput })),
}));
vi.mock("@langchain/google-genai", () => ({
  ChatGoogleGenerativeAI: vi.fn(() => ({ withStructuredOutput: mockWithStructuredOutput })),
}));

const MARKERLESS_INNER_TEXT = "USER BODY PROFILE (self-reported):\n- Bodyweight: 68 kg";

vi.mock("../prompt.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../prompt.js")>();
  return {
    ...actual,
    // Simulates a renderer that lost the `<body_profile>` delimiters: the
    // distinctive inner text is present in the rendered prompt, but nothing
    // wraps it, so `redactSpans` has no marker to match against.
    buildPlanPromptVariables: (spec: Parameters<typeof actual.buildPlanPromptVariables>[0]) => ({
      ...actual.buildPlanPromptVariables(spec),
      bodyProfileSection:
        (spec as { bodyProfile?: unknown }).bodyProfile ? `\n\n${MARKERLESS_INNER_TEXT}` : "",
    }),
  };
});

const { buildAdapters } = await import("../adapter-factory.js");
const { ResolvePrompt } = await import("../prompt-provider.js");
const { PLAN_PROMPT_TEMPLATE } = await import("../prompt.js");

/** A gateway that resolves cleanly — avoids the `no_credentials` fallback
 * warn `ResolvePrompt(null)` would otherwise emit on every call, which
 * would be unrelated noise in the warn-call assertions below. */
function freshResolvePrompt() {
  const gateway: LangfusePromptGateway = {
    fetchPrompt: vi.fn(async () => ({ template: PLAN_PROMPT_TEMPLATE, version: 1 })),
  };
  return new ResolvePrompt(gateway);
}

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

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(mockProgram);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("fail-closed backstop — a marker-less body-profile rendering degrades safely", () => {
  it("re-renders WITHOUT the body profile and logs the reason code, with no body value in the log payload", async () => {
    // Routed through `deps.prompts` deliberately: `buildPlanPrompt`'s
    // internal call to `buildPlanPromptVariables` is a same-module
    // reference and is NOT affected by mocking this module's exports —
    // only an EXTERNAL caller (adapter-factory.ts's own imported binding,
    // used on the `deps.prompts` branch) observes the mocked, marker-less
    // version.
    const adapters = buildAdapters({ prompts: freshResolvePrompt() });
    const adapter = adapters["openai"]!("gpt-4o-mini");

    const program = await adapter.generate({
      ...baseSpec,
      bodyProfile: { bodyweightKg: 68 },
    });

    // Generation still succeeds — a privacy bug degrades the plan, it never
    // fails the request.
    expect(program).toEqual(mockProgram);

    const invokeInput = mockInvoke.mock.calls[0]?.[0] as string;
    expect(invokeInput).not.toContain("USER BODY PROFILE");
    expect(invokeInput).not.toContain("68 kg");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message, payload] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("redaction unverified");
    expect(payload).toEqual({ reason: "body_profile_redaction_unverified" });
    // No body value anywhere in the log call, ever.
    expect(JSON.stringify(warnSpy.mock.calls[0])).not.toContain("68");
  });

  it("does not trip the backstop or warn when no body profile is present at all", async () => {
    const adapters = buildAdapters({ prompts: freshResolvePrompt() });
    const adapter = adapters["openai"]!("gpt-4o-mini");

    await adapter.generate(baseSpec);

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
