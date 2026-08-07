import { describe, it, expect, vi } from "vitest";
import type { PlanSpecDraft } from "@kinora/contracts";
import {
  PlanSpecExtractionAdapter,
  type ExtractionChatModel,
  type ExtractionCallOptions,
  type ExtractionModelFactory,
} from "../extraction-adapter.js";
import type { ChatExtractInput } from "../extraction-port.js";
import type { AiTracingDeps, TracingHandler } from "../langfuse-handler.js";
import { ResolvePrompt } from "../prompt-provider.js";
import type { LangfusePromptGateway } from "../prompt-source-port.js";
import { REPLY_PROMPT_TEMPLATE, EXTRACTION_PROMPT_TEMPLATE } from "../extraction-prompt.js";

// --- Fake chat model -------------------------------------------------------
//
// The real adapter is exercised WITHOUT any network/LLM: a deterministic fake
// satisfies the minimal `ExtractionChatModel` surface (`stream` +
// `withStructuredOutput`) the adapter depends on. This mirrors how
// MockPlanSpecExtractor stands in for the port at the route layer, but here we
// inject at the LANGCHAIN seam so the adapter's own two-pass logic is covered.

interface FakeModelSpec {
  /** Prose chunks yielded token-by-token by Pass 1 (`stream`). */
  tokens: string[];
  /** Structured object returned by Pass 2 (`withStructuredOutput().invoke`). */
  extracted: unknown;
  /** When set, Pass 1 (`stream`) rejects with this error. */
  streamError?: Error;
  /** When set, Pass 2 (`invoke`) rejects with this error. */
  extractError?: Error;
  /**
   * When set, Pass 2's `invoke` NEVER resolves/rejects on its own — it only
   * settles (rejects) when the call's `signal` fires `abort`, simulating a
   * stalled provider round-trip. Proves `extract()` propagates its `signal` all
   * the way to the LangChain call so an external abort actually cancels the
   * in-flight structured-output request instead of the caller blocking on it.
   */
  stallUntilAbort?: boolean;
}

interface RecordedCall {
  input: string;
  options?: ExtractionCallOptions;
}

function fakeModel(spec: FakeModelSpec) {
  const streamCalls: RecordedCall[] = [];
  const invokeCalls: RecordedCall[] = [];
  const structuredArgs: Array<{ schema: unknown; opts: { method: string } }> = [];

  const model: ExtractionChatModel = {
    async stream(input: string, options?: ExtractionCallOptions) {
      streamCalls.push({ input, options });
      if (spec.streamError) throw spec.streamError;
      const tokens = spec.tokens;
      async function* gen(): AsyncGenerator<{ content: unknown }> {
        for (const t of tokens) {
          yield { content: t };
        }
      }
      return gen();
    },
    withStructuredOutput(schema: unknown, opts: { method: string }) {
      structuredArgs.push({ schema, opts });
      return {
        async invoke(input: string, options?: ExtractionCallOptions) {
          invokeCalls.push({ input, options });
          if (spec.extractError) throw spec.extractError;
          if (spec.stallUntilAbort) {
            return new Promise((_resolve, reject) => {
              const signal = options?.signal;
              if (signal?.aborted) {
                reject(new Error("aborted"));
                return;
              }
              signal?.addEventListener(
                "abort",
                () => reject(new Error("aborted")),
                { once: true },
              );
              // Deliberately never resolves/rejects on its own — only the
              // signal's abort settles this call.
            });
          }
          return spec.extracted;
        },
      };
    },
  };

  return { model, streamCalls, invokeCalls, structuredArgs };
}

function buildAdapter(spec: FakeModelSpec, deps?: AiTracingDeps) {
  const fake = fakeModel(spec);
  const factory: ExtractionModelFactory = vi.fn(() => fake.model);
  const configRepo = { getActive: vi.fn().mockResolvedValue(null) };
  const adapter = new PlanSpecExtractionAdapter(configRepo, factory, deps);
  return { adapter, ...fake, factory, configRepo };
}

/** Minimal fake satisfying `TracingHandler` — no real Langfuse client. */
const FAKE_HANDLER: TracingHandler = {
  name: "fake-handler",
  flushAsync: () => Promise.resolve(),
};

const EMPTY_DRAFT: PlanSpecDraft = {};

function input(overrides: Partial<ChatExtractInput> = {}): ChatExtractInput {
  return { message: "build muscle 4 days a week with dumbbells", currentDraft: EMPTY_DRAFT, ...overrides };
}

describe("PlanSpecExtractionAdapter (real two-pass adapter, fake model)", () => {
  it("streamReply yields prose tokens from the LangChain .stream() pass (real progressive streaming)", async () => {
    const { adapter } = buildAdapter({ tokens: ["Got ", "it — ", "done."], extracted: {} });
    const controller = new AbortController();

    const out: string[] = [];
    for await (const tok of adapter.streamReply(input(), controller.signal)) out.push(tok);

    // More than one delta arrived (the typing effect is preserved).
    expect(out.length).toBeGreaterThan(1);
    expect(out).toEqual(["Got ", "it — ", "done."]);
  });

  it("streamReply stops early when the AbortSignal is already aborted", async () => {
    const { adapter, streamCalls } = buildAdapter({ tokens: ["a", "b", "c"], extracted: {} });
    const controller = new AbortController();
    controller.abort();

    const out: string[] = [];
    for await (const tok of adapter.streamReply(input(), controller.signal)) out.push(tok);

    // Aborted before any token is consumed.
    expect(out).toEqual([]);
    // Pre-aborted → NO LLM stream is ever opened (no wasted provider call).
    expect(streamCalls).toHaveLength(0);
  });

  it("forwards the AbortSignal to the model stream so an in-flight LLM stream can be cancelled", async () => {
    const { adapter, streamCalls } = buildAdapter({ tokens: ["a"], extracted: {} });
    const controller = new AbortController();

    // eslint-disable-next-line no-empty
    for await (const _ of adapter.streamReply(input(), controller.signal)) {
    }

    expect(streamCalls[0]?.options?.signal).toBe(controller.signal);
  });

  it("extract runs the terminal withStructuredOutput pass and validates via PlanSpecDraftSchema", async () => {
    const { adapter, structuredArgs, invokeCalls } = buildAdapter({
      tokens: [],
      // The fake returns a full valid extraction plus a forbidden key that the
      // schema parse must strip (preferenceScores is NEVER part of the draft).
      extracted: {
        goal: "hypertrophy",
        daysPerWeek: 4,
        equipment: ["dumbbells"],
        preferenceScores: { pushPull: 1 },
      },
    });

    const draft = await adapter.extract(input(), "Got it.");

    expect(draft.goal).toBe("hypertrophy");
    expect(draft.daysPerWeek).toBe(4);
    expect(draft.equipment).toEqual(["dumbbells"]);
    // Schema parse dropped the forbidden key.
    expect("preferenceScores" in draft).toBe(false);
    // jsonSchema structured-output method, matching the generation adapter.
    expect(structuredArgs[0]?.opts.method).toBe("jsonSchema");
    expect(invokeCalls).toHaveLength(1);
  });

  it("extract SEEDS Pass 2 with the assistant reply so the extraction is consistent with the prose", async () => {
    // The whole point of the redesign: Pass 2 reads Pass 1's reply so the
    // extracted fields agree with what the assistant just said. The reply text
    // MUST appear verbatim in the prompt handed to the structured-output call.
    const { adapter, invokeCalls } = buildAdapter({
      tokens: [],
      extracted: { daysPerWeek: 3 },
    });

    const reply = "For fat loss, 3 days a week of 40 minutes is a solid starting point.";
    await adapter.extract(input(), reply);

    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0]?.input).toContain(reply);
  });

  it("extract propagates a Pass-2 model failure (so the route can fail closed)", async () => {
    const { adapter } = buildAdapter({
      tokens: [],
      extracted: {},
      extractError: new Error("provider 500"),
    });

    await expect(adapter.extract(input(), "reply")).rejects.toThrow("provider 500");
  });

  it("extract forwards its AbortSignal into the Pass-2 call so an external abort cancels a stalled request", async () => {
    // HIGH fix: a wall-clock timeout firing DURING Pass 2 must cancel the
    // in-flight structured-output call, not block until the (possibly
    // never-resolving) provider round-trip settles on its own.
    const { adapter, invokeCalls } = buildAdapter({
      tokens: [],
      extracted: {},
      stallUntilAbort: true,
    });
    const controller = new AbortController();

    const promise = adapter.extract(input(), "reply", controller.signal);
    // Give the fake a turn to register its call before aborting.
    await Promise.resolve();
    controller.abort();

    await expect(promise).rejects.toThrow();
    // The signal was actually threaded into the LangChain call options.
    expect(invokeCalls[0]?.options?.signal).toBe(controller.signal);
  });

  it("MASKING: the observability payload masks known limitation text while the model still receives the prompt", async () => {
    // Threat Matrix: health/limitation leak to LLM/observability. A limitation
    // term already known in the draft MUST be redacted from BOTH the prompt the
    // model sees (buildReplyPrompt / buildExtractionPrompt) and the trace
    // metadata, while the structured extraction still succeeds.
    const HEALTH = "torn left ACL";
    const { adapter, streamCalls, invokeCalls } = buildAdapter({
      tokens: ["ok"],
      extracted: { goal: "strength" },
    });
    const controller = new AbortController();

    const draftInput = input({
      message: "I want to get stronger",
      currentDraft: { limitations: [{ text: HEALTH, isWarning: true }] },
    });

    // Drive both passes.
    let assistantReply = "";
    for await (const tok of adapter.streamReply(draftInput, controller.signal)) assistantReply += tok;
    const result = await adapter.extract(draftInput, assistantReply);

    // Extraction still works.
    expect(result.goal).toBe("strength");

    // The known health term never appears verbatim in the model input NOR in
    // the observability metadata for either pass.
    const allInputs = [...streamCalls, ...invokeCalls];
    expect(allInputs.length).toBeGreaterThan(0);
    for (const call of allInputs) {
      expect(call.input).not.toContain(HEALTH);
      expect(call.input).toContain("[REDACTED]");
      const meta = JSON.stringify(call.options?.metadata ?? {});
      expect(meta).not.toContain(HEALTH);
    }
  });

  it("reads provider config per turn (mirrors DynamicPlanGenerator) and passes trace metadata", async () => {
    const { adapter, streamCalls, factory, configRepo } = buildAdapter({
      tokens: ["hi"],
      extracted: {},
    });
    (configRepo.getActive as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "anthropic",
      model: "claude-x",
    });
    const controller = new AbortController();

    // eslint-disable-next-line no-empty
    for await (const _ of adapter.streamReply(input(), controller.signal)) {
    }

    expect(configRepo.getActive).toHaveBeenCalled();
    expect(factory).toHaveBeenCalledWith({ provider: "anthropic", model: "claude-x" });
    const meta = streamCalls[0]?.options?.metadata as Record<string, unknown> | undefined;
    expect(meta?.["provider"]).toBe("anthropic");
    expect(meta?.["feature"]).toBe("plan-chat-extraction");
  });
});

describe("PlanSpecExtractionAdapter tracing attachment (langfuse-prompt-management, slice A2)", () => {
  it("streamReply attaches the injected handler and omits the callbacks key entirely when none is injected", async () => {
    const withHandler = buildAdapter({ tokens: ["hi"], extracted: {} }, { handler: FAKE_HANDLER });
    const controller1 = new AbortController();
    // eslint-disable-next-line no-empty
    for await (const _ of withHandler.adapter.streamReply(input(), controller1.signal)) {
    }
    expect(withHandler.streamCalls[0]?.options?.callbacks).toEqual([FAKE_HANDLER]);

    const withoutHandler = buildAdapter({ tokens: ["hi"], extracted: {} });
    const controller2 = new AbortController();
    // eslint-disable-next-line no-empty
    for await (const _ of withoutHandler.adapter.streamReply(input(), controller2.signal)) {
    }
    expect(withoutHandler.streamCalls[0]?.options).not.toHaveProperty("callbacks");
  });

  it("extract attaches the injected handler and omits the callbacks key entirely when none is injected", async () => {
    const withHandler = buildAdapter({ tokens: [], extracted: {} }, { handler: FAKE_HANDLER });
    await withHandler.adapter.extract(input(), "reply");
    expect(withHandler.invokeCalls[0]?.options?.callbacks).toEqual([FAKE_HANDLER]);

    const withoutHandler = buildAdapter({ tokens: [], extracted: {} });
    await withoutHandler.adapter.extract(input(), "reply");
    expect(withoutHandler.invokeCalls[0]?.options).not.toHaveProperty("callbacks");
  });

  it("both passes still mask a KNOWN limitation while leaving signal/runName/metadata unchanged by the new deps arg", async () => {
    const HEALTH = "chronic tendinitis";
    const { adapter, streamCalls, invokeCalls } = buildAdapter(
      { tokens: ["ok"], extracted: { goal: "strength" } },
      { handler: FAKE_HANDLER },
    );
    const controller = new AbortController();

    const draftInput = input({
      message: "let's keep going",
      currentDraft: { limitations: [{ text: HEALTH, isWarning: true }] },
    });

    let assistantReply = "";
    for await (const tok of adapter.streamReply(draftInput, controller.signal)) assistantReply += tok;
    await adapter.extract(draftInput, assistantReply);

    expect(streamCalls[0]?.input).toContain("[REDACTED]");
    expect(streamCalls[0]?.input).not.toContain(HEALTH);
    expect(invokeCalls[0]?.input).toContain("[REDACTED]");
    expect(invokeCalls[0]?.input).not.toContain(HEALTH);

    expect(streamCalls[0]?.options?.signal).toBe(controller.signal);
    expect(streamCalls[0]?.options?.runName).toBe("plan-chat-extraction");
    expect(streamCalls[0]?.options?.metadata).toEqual({
      feature: "plan-chat-extraction",
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      promptSource: "fallback",
      promptLinked: false,
    });
    expect(invokeCalls[0]?.options?.runName).toBe("plan-chat-extraction");
    expect(invokeCalls[0]?.options?.metadata).toEqual({
      feature: "plan-chat-extraction",
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      promptSource: "fallback",
      promptLinked: false,
    });
  });
});

describe("PlanSpecExtractionAdapter prompt-source attribution (langfuse-prompt-management, slice B2)", () => {
  it("streamReply resolves the prompt through deps.prompts and attaches promptSource: langfuse on a successful remote fetch", async () => {
    const gateway: LangfusePromptGateway = {
      fetchPrompt: vi.fn(async () => ({ template: REPLY_PROMPT_TEMPLATE, version: 4 })),
    };
    const prompts = new ResolvePrompt(gateway);
    const { adapter, streamCalls } = buildAdapter({ tokens: ["ok"], extracted: {} }, { prompts });
    const controller = new AbortController();

    // eslint-disable-next-line no-empty
    for await (const _ of adapter.streamReply(input(), controller.signal)) {
    }

    expect(streamCalls[0]?.options?.metadata).toMatchObject({ promptSource: "langfuse" });
  });

  it("extract resolves the prompt through deps.prompts and attaches promptSource: langfuse on a successful remote fetch", async () => {
    const gateway: LangfusePromptGateway = {
      fetchPrompt: vi.fn(async () => ({ template: EXTRACTION_PROMPT_TEMPLATE, version: 4 })),
    };
    const prompts = new ResolvePrompt(gateway);
    const { adapter, invokeCalls } = buildAdapter({ tokens: [], extracted: {} }, { prompts });

    await adapter.extract(input(), "reply");

    expect(invokeCalls[0]?.options?.metadata).toMatchObject({ promptSource: "langfuse" });
  });

  it("both passes succeed with the LOCAL template when a real ResolvePrompt is wired but no Langfuse credentials are configured (production no-credentials shape)", async () => {
    // Mirrors app.ts's actual production wiring: a real ResolvePrompt is
    // ALWAYS constructed and injected, but its gateway is null when Langfuse
    // credentials are absent. A chat turn must succeed exactly as before.
    const prompts = new ResolvePrompt(null);
    const { adapter, streamCalls, invokeCalls } = buildAdapter(
      { tokens: ["hi"], extracted: { goal: "strength" } },
      { prompts },
    );
    const controller = new AbortController();

    let assistantReply = "";
    for await (const tok of adapter.streamReply(input(), controller.signal)) assistantReply += tok;
    const draft = await adapter.extract(input(), assistantReply);

    expect(draft.goal).toBe("strength");
    expect(streamCalls[0]?.options?.metadata).toMatchObject({ promptSource: "fallback" });
    expect(invokeCalls[0]?.options?.metadata).toMatchObject({ promptSource: "fallback" });
  });
});

describe("PlanSpecExtractionAdapter native prompt-version linkage attribution (slice C)", () => {
  it("streamReply attaches promptName/promptVersion/promptLabel/langfusePrompt on the langfuse path", async () => {
    const gateway: LangfusePromptGateway = {
      fetchPrompt: vi.fn(async () => ({ template: REPLY_PROMPT_TEMPLATE, version: 9 })),
    };
    const prompts = new ResolvePrompt(gateway);
    const { adapter, streamCalls } = buildAdapter({ tokens: ["ok"], extracted: {} }, { prompts });
    const controller = new AbortController();

    // eslint-disable-next-line no-empty
    for await (const _ of adapter.streamReply(input(), controller.signal)) {
    }

    expect(streamCalls[0]?.options?.metadata).toMatchObject({
      promptSource: "langfuse",
      promptName: "kinora-chat-reply",
      promptVersion: 9,
      promptLabel: "production",
      langfusePrompt: { name: "kinora-chat-reply", version: 9, isFallback: false },
    });
  });

  it("extract attaches promptName/promptVersion/promptLabel/langfusePrompt on the langfuse path", async () => {
    const gateway: LangfusePromptGateway = {
      fetchPrompt: vi.fn(async () => ({ template: EXTRACTION_PROMPT_TEMPLATE, version: 11 })),
    };
    const prompts = new ResolvePrompt(gateway);
    const { adapter, invokeCalls } = buildAdapter({ tokens: [], extracted: {} }, { prompts });

    await adapter.extract(input(), "reply");

    expect(invokeCalls[0]?.options?.metadata).toMatchObject({
      promptSource: "langfuse",
      promptName: "kinora-chat-extraction",
      promptVersion: 11,
      promptLabel: "production",
      langfusePrompt: { name: "kinora-chat-extraction", version: 11, isFallback: false },
    });
  });

  it("attaches promptLinked and NO promptName/promptVersion/langfusePrompt key on the fallback path, for both passes", async () => {
    const { adapter, streamCalls, invokeCalls } = buildAdapter({ tokens: ["ok"], extracted: {} });
    const controller = new AbortController();

    let assistantReply = "";
    for await (const tok of adapter.streamReply(input(), controller.signal)) assistantReply += tok;
    await adapter.extract(input(), assistantReply);

    const streamMetadata = streamCalls[0]?.options?.metadata as Record<string, unknown>;
    expect(streamMetadata["promptSource"]).toBe("fallback");
    expect(streamMetadata).toHaveProperty("promptLinked");
    expect(streamMetadata).not.toHaveProperty("promptName");
    expect(streamMetadata).not.toHaveProperty("promptVersion");
    expect(streamMetadata).not.toHaveProperty("langfusePrompt");

    const invokeMetadata = invokeCalls[0]?.options?.metadata as Record<string, unknown>;
    expect(invokeMetadata["promptSource"]).toBe("fallback");
    expect(invokeMetadata).toHaveProperty("promptLinked");
    expect(invokeMetadata).not.toHaveProperty("promptName");
    expect(invokeMetadata).not.toHaveProperty("promptVersion");
    expect(invokeMetadata).not.toHaveProperty("langfusePrompt");
  });

  it("promptLinked is false because the fake model in this test file is a plain object, not a real Runnable/RunnableSequence, so the shape guard declines — both passes still succeed", async () => {
    const { adapter, streamCalls, invokeCalls } = buildAdapter({ tokens: ["ok"], extracted: { goal: "strength" } });
    const controller = new AbortController();

    let assistantReply = "";
    for await (const tok of adapter.streamReply(input(), controller.signal)) assistantReply += tok;
    const draft = await adapter.extract(input(), assistantReply);

    expect(draft.goal).toBe("strength");
    expect((streamCalls[0]?.options?.metadata as Record<string, unknown>)?.["promptLinked"]).toBe(false);
    expect((invokeCalls[0]?.options?.metadata as Record<string, unknown>)?.["promptLinked"]).toBe(false);
  });
});

describe("PlanSpecExtractionAdapter masking relocation (langfuse-prompt-management, slice B1)", () => {
  // `buildReplyPrompt`/`buildExtractionPrompt` now return UNMASKED text; these
  // assertions MOVED here from `extraction-prompt.test.ts` to prove the
  // call-site `mask()` in `extraction-adapter.ts` is what actually reaches
  // the model, mirroring `invokeChain`'s masking for the plan prompt.

  it("masks a KNOWN limitation term from the current draft in both passes", async () => {
    const { adapter, streamCalls, invokeCalls } = buildAdapter({
      tokens: ["ok"],
      extracted: { goal: "strength" },
    });
    const controller = new AbortController();
    const draftInput = input({
      message: "let's build a plan",
      currentDraft: { limitations: [{ text: "lower back pain", isWarning: true }] },
    });

    let assistantReply = "";
    for await (const tok of adapter.streamReply(draftInput, controller.signal)) assistantReply += tok;
    await adapter.extract(draftInput, assistantReply);

    expect(streamCalls[0]?.input).not.toContain("lower back pain");
    expect(streamCalls[0]?.input).toContain("[REDACTED]");
    expect(invokeCalls[0]?.input).not.toContain("lower back pain");
    expect(invokeCalls[0]?.input).toContain("[REDACTED]");
  });

  it("masks a KNOWN limitation term even when the user repeats it in this turn's message (streamReply)", async () => {
    const { adapter, streamCalls } = buildAdapter({ tokens: ["ok"], extracted: {} });
    const controller = new AbortController();
    const draftInput = input({
      message: "I still have lower back pain so keep it light",
      currentDraft: { limitations: [{ text: "lower back pain", isWarning: true }] },
    });

    for await (const _tok of adapter.streamReply(draftInput, controller.signal)) {
      /* drain */
    }

    expect(streamCalls[0]?.input).not.toContain("lower back pain");
    expect(streamCalls[0]?.input).toContain("[REDACTED]");
  });

  it("masks a KNOWN limitation term even when it appears inside the seeded assistant reply (extract)", async () => {
    const { adapter, invokeCalls } = buildAdapter({ tokens: [], extracted: {} });
    const draftInput = input({
      currentDraft: { limitations: [{ text: "lower back pain", isWarning: true }] },
    });

    await adapter.extract(draftInput, "Given your lower back pain, let's keep it light.");

    expect(invokeCalls[0]?.input).not.toContain("lower back pain");
    expect(invokeCalls[0]?.input).toContain("[REDACTED]");
  });

  it("does NOT mask a first-mention health/limitation phrase in either pass (accurate, not a bug)", async () => {
    const { adapter, streamCalls, invokeCalls } = buildAdapter({ tokens: ["ok"], extracted: {} });
    const controller = new AbortController();
    const draftInput = input({
      message: "I have lower back pain, build muscle 4 days",
      currentDraft: {},
    });

    for await (const _tok of adapter.streamReply(draftInput, controller.signal)) {
      /* drain */
    }
    await adapter.extract(draftInput, "Understood.");

    expect(streamCalls[0]?.input).toContain("lower back pain");
    expect(streamCalls[0]?.input).not.toContain("[REDACTED]");
    expect(invokeCalls[0]?.input).toContain("lower back pain");
    expect(invokeCalls[0]?.input).not.toContain("[REDACTED]");
  });
});
