import { describe, it, expect, vi } from "vitest";
import type { PlanSpecDraft } from "@kinora/contracts";
import {
  PlanSpecExtractionAdapter,
  type ExtractionChatModel,
  type ExtractionCallOptions,
  type ExtractionModelFactory,
} from "../extraction-adapter.js";
import type { ChatExtractInput } from "../extraction-port.js";

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

function buildAdapter(spec: FakeModelSpec) {
  const fake = fakeModel(spec);
  const factory: ExtractionModelFactory = vi.fn(() => fake.model);
  const configRepo = { getActive: vi.fn().mockResolvedValue(null) };
  const adapter = new PlanSpecExtractionAdapter(configRepo, factory);
  return { adapter, ...fake, factory, configRepo };
}

const EMPTY_DRAFT: PlanSpecDraft = {};

function input(overrides: Partial<ChatExtractInput> = {}): ChatExtractInput {
  return { message: "build muscle 4 days a week with dumbbells", currentDraft: EMPTY_DRAFT, ...overrides };
}

describe("PlanSpecExtractionAdapter (real two-pass adapter, fake model)", () => {
  it("streamReply yields prose tokens from the LangChain .stream() pass", async () => {
    const { adapter } = buildAdapter({ tokens: ["Got ", "it — ", "done."], extracted: {} });
    const controller = new AbortController();

    const out: string[] = [];
    for await (const tok of adapter.streamReply(input(), controller.signal)) out.push(tok);

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

    const draft = await adapter.extract(input());

    expect(draft.goal).toBe("hypertrophy");
    expect(draft.daysPerWeek).toBe(4);
    expect(draft.equipment).toEqual(["dumbbells"]);
    // Schema parse dropped the forbidden key.
    expect("preferenceScores" in draft).toBe(false);
    // jsonSchema structured-output method, matching the generation adapter.
    expect(structuredArgs[0]?.opts.method).toBe("jsonSchema");
    expect(invokeCalls).toHaveLength(1);
  });

  it("extract propagates a Pass-2 model failure (so the route can fail closed)", async () => {
    const { adapter } = buildAdapter({
      tokens: [],
      extracted: {},
      extractError: new Error("provider 500"),
    });

    await expect(adapter.extract(input())).rejects.toThrow("provider 500");
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

    const promise = adapter.extract(input(), controller.signal);
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
    // model sees (S1 buildExtractionPrompt) and the trace metadata, while the
    // structured extraction still succeeds.
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
    // eslint-disable-next-line no-empty
    for await (const _ of adapter.streamReply(draftInput, controller.signal)) {
    }
    const result = await adapter.extract(draftInput);

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
