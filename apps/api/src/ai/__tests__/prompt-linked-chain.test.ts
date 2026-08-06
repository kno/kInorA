import { describe, it, expect, vi } from "vitest";
import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
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

interface RecordedEvent {
  event: "chain" | "chat_model";
  runId: string;
  parentRunId?: string;
  metadata?: Record<string, unknown>;
  payload: unknown;
}

/** Records (runId, parentRunId, metadata, payload) for every start event observed. */
function fakeCallbackHandler() {
  const events: RecordedEvent[] = [];
  return {
    events,
    handleChainStart(
      _chain: unknown,
      inputs: unknown,
      runId: string,
      _runType?: string,
      _tags?: string[],
      metadata?: Record<string, unknown>,
      _runName?: string,
      parentRunId?: string,
    ) {
      events.push({ event: "chain", runId, parentRunId, metadata, payload: inputs });
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
  it("every run in the reparented sequence observes only the already-rendered, already-masked prompt string", async () => {
    const model = new CannedChatModel("ok");
    const parser = RunnableLambda.from((message: AIMessage) => String(message.content));
    const structured = RunnableSequence.from([model, parser]);
    const { chain } = linkStructuredChain(structured);

    const maskedPrompt = "User context: [REDACTED] before training.";
    const observed: unknown[] = [];
    const handler = {
      handleChainStart(_chain: unknown, inputs: unknown) {
        observed.push(inputs);
      },
      handleChatModelStart(_llm: unknown, messages: unknown) {
        observed.push(messages);
      },
    };

    await chain.invoke(maskedPrompt, { callbacks: [handler] });

    expect(observed.length).toBeGreaterThan(0);
    for (const payload of observed) {
      const serialized = JSON.stringify(payload);
      expect(serialized).toContain("[REDACTED]");
      expect(serialized).not.toContain("osteoporosis");
    }
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
