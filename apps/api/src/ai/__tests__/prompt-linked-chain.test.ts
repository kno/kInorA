import { describe, it, expect, vi } from "vitest";
import { RunnableSequence, RunnableLambda, RunnableBinding } from "@langchain/core/runnables";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BindToolsInput } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { WorkoutProgramSchema } from "@kinora/contracts";
import { promptStep, linkStructuredChain, linkStreamingModel } from "../prompt-linked-chain.js";

/**
 * ~15-line offline chat model (design.md's "Unit run-parenting" test
 * approach) — @langchain/core@1.2.1 ships no exported test fakes, so a local
 * `BaseChatModel` subclass is what produces a genuine `handleChatModelStart`
 * callback event with no network access and no credentials.
 */
class CannedChatModel extends BaseChatModel {
  constructor(private readonly reply: string) {
    super({});
  }
  _llmType(): string {
    return "canned-fake";
  }
  async _generate(): Promise<ChatResult> {
    const message = new AIMessage(this.reply);
    return { generations: [{ message, text: this.reply }] };
  }
}

/**
 * Offline model that drives the REAL `withStructuredOutput` code path, so the
 * SDK shape pins below observe what the SDK actually builds rather than a
 * hand-assembled stand-in. Two SDK preconditions shape this class:
 *
 * - core's base `withStructuredOutput` throws unless `bindTools` exists, and
 *   `@langchain/core@1.x` binds through `withConfig` (the older `.bind` is
 *   gone) — the same way `ChatAnthropic.bindTools` does it.
 * - the parser core pipes the model into rejects anything that is not an
 *   `AIMessageChunk`, and looks for a tool call named `extract` (the default
 *   function name core derives for a Zod schema without an explicit `name`).
 */
class CannedToolCallingChatModel extends BaseChatModel {
  constructor(private readonly toolArgs: Record<string, unknown>) {
    super({});
  }
  _llmType(): string {
    return "canned-tool-calling-fake";
  }
  async _generate(): Promise<ChatResult> {
    const message = new AIMessageChunk({
      content: "",
      tool_calls: [{ name: "extract", args: this.toolArgs, id: "call_1", type: "tool_call" }],
    });
    return { generations: [{ message, text: "" }] };
  }
  override bindTools(tools: BindToolsInput[]) {
    return this.withConfig({ tools } as Parameters<BaseChatModel["withConfig"]>[0]);
  }
}

interface RecordedEvent {
  event: "chain" | "chat_model";
  runId: string;
  parentRunId?: string;
  metadata?: Record<string, unknown>;
  runName?: string;
  payload: unknown;
}

/** Records (runId, parentRunId, metadata, payload) for every start event observed. */
function fakeCallbackHandler() {
  const events: RecordedEvent[] = [];
  return {
    events,
    // NOTE: the runtime call order (`CallbackManager.handleChainStart` in
    // `@langchain/core/callbacks/manager.js`) is
    // `(chain, inputs, runId, parentRunId, tags, metadata, runType, runName, extra)`
    // — `parentRunId` is the 4th positional argument, NOT where the handler
    // interface's own `.d.ts` parameter names would suggest.
    handleChainStart(
      _chain: unknown,
      inputs: unknown,
      runId: string,
      parentRunId: string | undefined,
      _tags?: string[],
      metadata?: Record<string, unknown>,
      _runType?: string,
      runName?: string,
    ) {
      events.push({ event: "chain", runId, parentRunId, metadata, runName, payload: inputs });
    },
    handleChatModelStart(
      _llm: unknown,
      messages: unknown,
      runId: string,
      parentRunId?: string,
      _extraParams?: unknown,
      _tags?: string[],
      metadata?: Record<string, unknown>,
    ) {
      events.push({ event: "chat_model", runId, parentRunId, metadata, payload: messages });
    },
  };
}

describe("promptStep", () => {
  it("is an identity runnable over the already-rendered, already-masked prompt string", async () => {
    const step = promptStep();
    await expect(step.invoke("hello [REDACTED] world")).resolves.toBe("hello [REDACTED] world");
  });
});

describe("run-parenting (slice C)", () => {
  it("registers the prompt step and the model as siblings under the outer sequence's own run, inheriting metadata.langfusePrompt", async () => {
    const model = new CannedChatModel("hello");
    const parser = RunnableLambda.from((message: AIMessage) => String(message.content));
    const structured = RunnableSequence.from([model, parser]);

    const { chain, linked } = linkStructuredChain(structured);
    expect(linked).toBe(true);

    const handler = fakeCallbackHandler();
    const langfusePrompt = { name: "kinora-plan-generation", version: 3, isFallback: false };
    const result = await chain.invoke("masked prompt text", {
      callbacks: [handler],
      metadata: { langfusePrompt },
    });
    expect(result).toBe("hello");

    const chainEvents = handler.events.filter((e) => e.event === "chain");
    const outerStart = chainEvents.find((e) => e.parentRunId === undefined);
    expect(outerStart).toBeDefined();
    const outerRunId = outerStart!.runId;

    const promptStepStart = chainEvents.find((e) => e.runId !== outerRunId);
    expect(promptStepStart).toBeDefined();
    expect(promptStepStart!.parentRunId).toBe(outerRunId);
    expect(promptStepStart!.metadata).toEqual(expect.objectContaining({ langfusePrompt }));

    const modelStart = handler.events.find((e) => e.event === "chat_model");
    expect(modelStart).toBeDefined();
    expect(modelStart!.parentRunId).toBe(outerRunId);
  });

  it("wraps a bare streaming model as [promptStep, model] with the same sibling parentage", async () => {
    const model = new CannedChatModel("streamed");
    const { chain, linked } = linkStreamingModel(model);
    expect(linked).toBe(true);

    const handler = fakeCallbackHandler();
    await chain.invoke("masked chat prompt", { callbacks: [handler] });

    const chainEvents = handler.events.filter((e) => e.event === "chain");
    const outerStart = chainEvents.find((e) => e.parentRunId === undefined);
    expect(outerStart).toBeDefined();
    const promptStepStart = chainEvents.find((e) => e.runId !== outerStart!.runId);
    expect(promptStepStart?.parentRunId).toBe(outerStart!.runId);

    const modelStart = handler.events.find((e) => e.event === "chat_model");
    expect(modelStart?.parentRunId).toBe(outerStart!.runId);
  });
});

describe("masking invariant across the restructured chain (slice C)", () => {
  it("the outer sequence, the prompt step, and the model all observe only the already-rendered, already-masked prompt string — never the raw term", async () => {
    const model = new CannedChatModel("ok");
    const parser = RunnableLambda.from((message: AIMessage) => String(message.content));
    const structured = RunnableSequence.from([model, parser]);
    const { chain } = linkStructuredChain(structured);

    const maskedPrompt = "User context: [REDACTED] before training.";
    const chainInputs: unknown[] = [];
    const modelMessages: unknown[] = [];
    const handler = {
      handleChainStart(_chain: unknown, inputs: unknown) {
        chainInputs.push(inputs);
      },
      handleChatModelStart(_llm: unknown, messages: unknown) {
        modelMessages.push(messages);
      },
    };

    await chain.invoke(maskedPrompt, { callbacks: [handler] });

    // The outer sequence's own start AND the prompt step's start both carry
    // the invoke input verbatim, wrapped as `{ input: <string> }` by
    // `RunnableLambda`'s tracing — both must be the masked string, never the
    // raw term. The parser step ALSO fires handleChainStart, but its input is
    // the model's AIMessage output, not the prompt, so it is deliberately
    // excluded by filtering to the string-input-shaped chain starts.
    const promptStringInputs = chainInputs.filter(
      (inputs): inputs is { input: string } =>
        typeof inputs === "object" && inputs !== null && typeof (inputs as { input?: unknown }).input === "string",
    );
    expect(promptStringInputs.length).toBeGreaterThanOrEqual(2);
    for (const inputs of promptStringInputs) {
      const serialized = JSON.stringify(inputs);
      expect(serialized).toContain("[REDACTED]");
      expect(serialized).not.toContain("osteoporosis");
    }

    // The model's own handleChatModelStart carries the prompt as the message
    // content it actually receives.
    expect(modelMessages.length).toBe(1);
    const modelSerialized = JSON.stringify(modelMessages[0]);
    expect(modelSerialized).toContain("[REDACTED]");
    expect(modelSerialized).not.toContain("osteoporosis");
  });
});

describe("output equivalence (slice C)", () => {
  it("the reparented flat sequence produces an output identical to the untouched structured-output sequence", async () => {
    const program = { weeklySessions: [{ day: 1, title: "Day 1", exercises: [] }], limitationWarnings: [] };
    const canned = new CannedChatModel(JSON.stringify(program));
    const parser = RunnableLambda.from((message: AIMessage) => JSON.parse(String(message.content)) as unknown);
    const structured = RunnableSequence.from([canned, parser]);

    const untouchedResult = await structured.invoke("masked prompt");

    const { chain, linked } = linkStructuredChain(structured);
    expect(linked).toBe(true);
    const linkedResult = await chain.invoke("masked prompt");

    expect(linkedResult).toEqual(untouchedResult);
    expect(WorkoutProgramSchema.parse(linkedResult)).toEqual(WorkoutProgramSchema.parse(untouchedResult));
  });
});

/**
 * SDK structured-output shape pins (issue #375).
 *
 * Every OTHER test in this file hands `linkStructuredChain` a chain assembled
 * BY HAND (`RunnableSequence.from([model, parser])`). Those prove the guard
 * handles that shape correctly; none of them proves the SDK still PRODUCES it.
 * If a `@langchain/*` bump changed the returned shape, all of them would stay
 * green and the only signal would be `promptLinked: false` quietly appearing
 * in trace metadata.
 *
 * These pins close that gap by calling `withStructuredOutput` FOR REAL, with
 * the exact production call shape — `{ method }`, never `includeRaw`
 * (`adapter-factory.ts`). Constructing a provider client performs no network
 * I/O, so a placeholder key is enough to inspect the chain it builds.
 *
 * A bump of `@langchain/core`, `@langchain/openai`, `@langchain/anthropic` or
 * `@langchain/google-genai` is what turns these red.
 */
function sdkDrift(what: string): string {
  return [
    `@langchain structured-output shape drift: ${what}.`,
    "You most likely did NOT break this — a dependency bump did.",
    "apps/api/src/ai/prompt-linked-chain.ts decomposes what withStructuredOutput()",
    "returns and depends on that shape, so its guard needs updating for the new one,",
    "and then this pin does too. Left unfixed it degrades silently: generation keeps",
    "working, but Langfuse native prompt linkage stops (promptLinked: false).",
  ].join(" ");
}

describe("SDK structured-output shape (issue #375)", () => {
  const program = {
    weeklySessions: [{ day: 1, title: "Day 1", exercises: [] }],
    limitationWarnings: [],
  };

  // Both methods `adapter-factory.ts` uses: "jsonSchema" for openai/openrouter
  // and "jsonMode" for opencode-go. Neither passes `includeRaw`.
  it.each(["jsonSchema", "jsonMode"] as const)(
    "ChatOpenAI.withStructuredOutput(schema, { method: '%s' }) still returns a two-step RunnableSequence whose first step is the model",
    (method) => {
      const llm = new ChatOpenAI({ apiKey: "placeholder-key", model: "gpt-4o-mini" });
      const structured = llm.withStructuredOutput(WorkoutProgramSchema, { method });

      expect(
        RunnableSequence.isRunnableSequence(structured),
        sdkDrift(`ChatOpenAI (method: ${method}) no longer returns a RunnableSequence`),
      ).toBe(true);

      const { steps } = structured as unknown as { steps: unknown[] };
      expect(steps, sdkDrift(`ChatOpenAI (method: ${method}) no longer returns a TWO-step sequence`)).toHaveLength(2);
      expect(
        steps[0] instanceof BaseChatModel,
        sdkDrift(`ChatOpenAI (method: ${method}) no longer puts the model FIRST in the sequence`),
      ).toBe(true);

      expect(
        linkStructuredChain(structured).linked,
        sdkDrift(`linkStructuredChain declines ChatOpenAI's real chain (method: ${method})`),
      ).toBe(true);
    },
  );

  it("core's base withStructuredOutput wraps the [model, parser] sequence in a RunnableBinding that only names the run", () => {
    const structured = new CannedToolCallingChatModel(program).withStructuredOutput(WorkoutProgramSchema);

    expect(
      structured instanceof RunnableBinding,
      sdkDrift("core's base withStructuredOutput no longer returns a RunnableBinding"),
    ).toBe(true);

    const { bound, config, kwargs, configFactories } = structured as unknown as {
      bound: unknown;
      config: Record<string, unknown>;
      kwargs?: Record<string, unknown>;
      configFactories?: unknown[];
    };
    // `linkStructuredChain` unwraps this binding, which is only lossless while
    // the wrapper holds NOTHING but the run name — hence `Object.keys`, not
    // just `toEqual` (which ignores explicitly-undefined keys).
    expect(config, sdkDrift("core's base structured-output binding carries more than a runName")).toEqual({
      runName: "StructuredOutput",
    });
    expect(
      Object.keys(config),
      sdkDrift("core's base structured-output binding config gained keys beyond runName"),
    ).toEqual(["runName"]);
    expect(
      Object.keys(kwargs ?? {}),
      sdkDrift("core's base structured-output binding now carries bound kwargs, which unwrapping would discard"),
    ).toEqual([]);
    expect(
      configFactories ?? [],
      sdkDrift("core's base structured-output binding now carries config factories, which unwrapping would discard"),
    ).toEqual([]);
    expect(
      RunnableSequence.isRunnableSequence(bound),
      sdkDrift("core's base structured-output binding no longer wraps a RunnableSequence"),
    ).toBe(true);
    expect(
      (bound as { steps: unknown[] }).steps,
      sdkDrift("core's base structured-output sequence is no longer [model, parser]"),
    ).toHaveLength(2);
  });

  it("linkStructuredChain reparents the SDK's OWN structured sequence and yields an identical, schema-valid result", async () => {
    const structured = new CannedToolCallingChatModel(program).withStructuredOutput(WorkoutProgramSchema);
    // The sequence built by the SDK itself — not by this test — which is what
    // `linkStructuredChain` reparents wherever a provider hands it back unwrapped.
    const { bound: sdkSequence } = structured as unknown as {
      bound: { invoke: (input: string, options?: Record<string, unknown>) => Promise<unknown> };
    };

    const untouchedResult = await sdkSequence.invoke("masked prompt");

    const { chain, linked } = linkStructuredChain(sdkSequence);
    expect(linked, sdkDrift("linkStructuredChain declines the sequence the SDK itself built")).toBe(true);
    const linkedResult = await chain.invoke("masked prompt", {});

    expect(linkedResult).toEqual(untouchedResult);
    expect(WorkoutProgramSchema.parse(linkedResult)).toEqual(WorkoutProgramSchema.parse(untouchedResult));
  });

  // These two inherit core's base implementation, so they hand back the
  // RunnableBinding wrapper rather than the bare sequence ChatOpenAI returns.
  // `linkStructuredChain` unwraps that one shape, so they link too.
  it.each([
    ["ChatAnthropic", () => new ChatAnthropic({ apiKey: "placeholder-key", model: "claude-3-5-sonnet-latest" })],
    [
      "ChatGoogleGenerativeAI",
      () => new ChatGoogleGenerativeAI({ apiKey: "placeholder-key", model: "gemini-2.0-flash" }),
    ],
  ] as const)("%s returns a RunnableBinding-wrapped sequence, which the guard unwraps and links", (name, makeLlm) => {
    const structured = makeLlm().withStructuredOutput(WorkoutProgramSchema, { method: "jsonSchema" });

    expect(structured instanceof RunnableBinding, `${name}: expected core's RunnableBinding wrapper`).toBe(true);
    expect(RunnableSequence.isRunnableSequence(structured)).toBe(false);
    // The [boundModel, parser] sequence is still in there, one level down.
    expect(
      RunnableSequence.isRunnableSequence((structured as unknown as { bound: unknown }).bound),
      `${name}: expected the wrapper to hold a RunnableSequence`,
    ).toBe(true);

    expect(
      linkStructuredChain(structured).linked,
      sdkDrift(`linkStructuredChain no longer links ${name}'s real chain`),
    ).toBe(true);
  });

  it("the unwrapped path keeps the SDK's runName and still parents the model as the prompt step's sibling", async () => {
    const structured = new CannedToolCallingChatModel(program).withStructuredOutput(WorkoutProgramSchema);
    const { chain, linked } = linkStructuredChain(structured);
    expect(linked).toBe(true);

    const handler = fakeCallbackHandler();
    const langfusePrompt = { name: "kinora-plan-generation", version: 3, isFallback: false };
    await chain.invoke("masked prompt text", { callbacks: [handler], metadata: { langfusePrompt } });

    const chainEvents = handler.events.filter((e) => e.event === "chain");
    const outerStart = chainEvents.find((e) => e.parentRunId === undefined);
    expect(outerStart).toBeDefined();
    // `withConfig` merges into the sequence's own run rather than adding one of
    // its own, so the run keeps the SDK's name AND stays the shared parent.
    expect(outerStart!.runName).toBe("StructuredOutput");

    const promptStepStart = chainEvents.find((e) => e.runId !== outerStart!.runId);
    expect(promptStepStart?.parentRunId).toBe(outerStart!.runId);
    expect(promptStepStart?.metadata).toEqual(expect.objectContaining({ langfusePrompt }));

    const modelStart = handler.events.find((e) => e.event === "chat_model");
    expect(modelStart?.parentRunId).toBe(outerStart!.runId);
  });

  it("the unwrapped chain produces an output identical to the untouched binding", async () => {
    const structured = new CannedToolCallingChatModel(program).withStructuredOutput(WorkoutProgramSchema);

    const untouchedResult = await structured.invoke("masked prompt");
    const { chain } = linkStructuredChain(structured);
    const linkedResult = await chain.invoke("masked prompt", {});

    expect(linkedResult).toEqual(untouchedResult);
    expect(WorkoutProgramSchema.parse(linkedResult)).toEqual(WorkoutProgramSchema.parse(untouchedResult));
  });
});

describe("guard degradation (slice C)", () => {
  it("linkStructuredChain declines a plain object with .invoke (not a real RunnableSequence) and still generates", async () => {
    const plainObjectWithInvoke = { invoke: vi.fn(async () => ({ ok: true })) };
    const result = linkStructuredChain(plainObjectWithInvoke);
    expect(result.linked).toBe(false);
    expect(result.chain).toBe(plainObjectWithInvoke);
    await expect(result.chain.invoke("prompt", {})).resolves.toEqual({ ok: true });
  });

  it("linkStructuredChain declines null/undefined without throwing, despite isRunnableSequence dereferencing .middle", () => {
    type StructuredLike = { invoke: (input: string, options?: unknown) => Promise<unknown> };
    expect(() => linkStructuredChain(null as unknown as StructuredLike)).not.toThrow();
    expect(linkStructuredChain(null as unknown as StructuredLike)).toEqual({ chain: null, linked: false });
    expect(() => linkStructuredChain(undefined as unknown as StructuredLike)).not.toThrow();
    expect(linkStructuredChain(undefined as unknown as StructuredLike)).toEqual({
      chain: undefined,
      linked: false,
    });
  });

  it("linkStructuredChain declines an includeRaw-shaped RunnableMap-first fake (not a real Runnable) and does not reparent it", () => {
    const includeRawShaped = {
      invoke: vi.fn(async () => ({ raw: {}, parsed: {} })),
      steps: [{ invoke: vi.fn() }, { invoke: vi.fn() }],
    };
    const result = linkStructuredChain(includeRawShaped);
    expect(result).toEqual({ chain: includeRawShaped, linked: false });
  });

  // The RunnableBinding unwrap must stay a match on ONE pinned shape, never a
  // blanket "unwrap any binding": a wrapper carrying bound arguments or config
  // factories would lose them, and a wrapper carrying real config would lose
  // that too. Each of these binds something core's structured-output wrapper
  // never carries, so each must still be declined and returned UNTOUCHED.
  it.each([
    ["a second config key beyond runName", { runName: "StructuredOutput", tags: ["x"] }, {}, []],
    ["config without a runName at all", { metadata: { a: 1 } }, {}, []],
    ["bound kwargs", { runName: "StructuredOutput" }, { tools: [{ name: "t" }] }, []],
    ["config factories", { runName: "StructuredOutput" }, {}, [() => ({})]],
  ] as const)(
    "linkStructuredChain declines a RunnableBinding-shaped chain carrying %s",
    (_case, config, kwargs, configFactories) => {
      const inner = RunnableSequence.from([
        RunnableLambda.from((input: string) => input),
        RunnableLambda.from((input: string) => input),
      ]);
      const binding = Object.assign(Object.create(RunnableBinding.prototype) as object, {
        bound: inner,
        config,
        kwargs,
        configFactories,
      });

      const result = linkStructuredChain(binding as unknown as { invoke: () => Promise<unknown> });
      expect(result.linked).toBe(false);
      expect(result.chain).toBe(binding);
    },
  );

  it("linkStructuredChain declines a binding whose bound value is not a RunnableSequence", () => {
    const binding = Object.assign(Object.create(RunnableBinding.prototype) as object, {
      bound: RunnableLambda.from((input: string) => input),
      config: { runName: "StructuredOutput" },
      kwargs: {},
    });

    const result = linkStructuredChain(binding as unknown as { invoke: () => Promise<unknown> });
    expect(result.linked).toBe(false);
    expect(result.chain).toBe(binding);
  });

  it("linkStreamingModel declines a plain object with .stream (not a real Runnable) and still generates", async () => {
    const plainStreamingModel = {
      stream: vi.fn(async () => (async function* () { yield { content: "ok" }; })()),
    };
    const result = linkStreamingModel(plainStreamingModel);
    expect(result.linked).toBe(false);
    expect(result.chain).toBe(plainStreamingModel);
  });

  it("linkStreamingModel declines null/undefined without throwing", () => {
    type StreamingLike = { stream: (input: string, options?: unknown) => Promise<unknown> };
    expect(() => linkStreamingModel(null as unknown as StreamingLike)).not.toThrow();
    expect(linkStreamingModel(undefined as unknown as StreamingLike)).toEqual({
      chain: undefined,
      linked: false,
    });
  });
});
