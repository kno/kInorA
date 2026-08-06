import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { PlanSpecDraftSchema } from "@kinora/contracts";
import type { PlanSpecDraft } from "@kinora/contracts";
import type { ChatExtractInput, PlanSpecExtractor } from "./extraction-port.js";
import { buildReplyPrompt, buildExtractionPrompt } from "./extraction-prompt.js";
import type { DynamicConfigRepo } from "./dynamic-generator.js";
import type { AiTracingDeps } from "./langfuse-handler.js";

/**
 * LangChain-backed extraction adapter for the conversational create-plan turn
 * (12-v1.1-interactive-text-chat, S2b).
 *
 * This is the ONLY place the LangChain dependency enters the chat path — the
 * route (`plan.ts`) depends on the `PlanSpecExtractor` port, never on LangChain,
 * so the deps-guard/architecture confinement (LLM code lives only under
 * `apps/api/src/ai/`) holds.
 *
 * TWO passes per turn (real streaming + consistency):
 *   - Pass 1 `streamReply()` — a PLAIN (non-structured) `.stream()` call that
 *     streams the assistant PROSE token-by-token via `buildReplyPrompt()`,
 *     honoring the `AbortSignal` (client disconnect / server timeout aborts the
 *     underlying LLM stream). This restores the real progressive typing effect
 *     that structured-output streaming lost (some providers, e.g. Gemini, emit
 *     structured output as a single non-progressive chunk).
 *   - Pass 2 `extract()` — a terminal, non-streamed structured extraction via
 *     `withStructuredOutput(PlanSpecDraftSchema, { method: "jsonSchema" })`,
 *     mirroring the proven generation adapter (`adapter-factory.ts`). Its prompt
 *     (`buildExtractionPrompt(input, assistantReply)`) INCLUDES the Pass-1 reply,
 *     so the extracted fields are CONSISTENT with what the assistant just said.
 *     The result is re-parsed with `PlanSpecDraftSchema` at this boundary so a
 *     forbidden or malformed key can never leak past the adapter.
 *
 * Because Pass 2 reads Pass 1's output, the prose and the committed draft agree
 * by construction (Pass 2 is seeded with, and grounded in, the reply).
 *
 * Provider selection mirrors `DynamicPlanGenerator`: the active provider/model is
 * read from the DB config on EVERY call and a fresh model is built via the
 * injected factory. Tests inject a deterministic fake factory — no network.
 *
 * OBSERVABILITY / MASKING (langfuse-prompt-management, slice A2): the prompts
 * handed to the model are `buildReplyPrompt()` / `buildExtractionPrompt()`
 * output, which mask ALL already-known limitation/health terms via `mask()`
 * (a first-mention phrase is unavoidably present — it is the minimal exposure
 * the feature needs, see `extraction-prompt.ts`). Superseded: this used to
 * say NO callback handler is ever attached here — that rationale is
 * deliberately overridden now, mirroring `invokeChain`'s A1 wiring exactly.
 * An optional `deps.handler` (the same injectable Langfuse tracing handler
 * built once in `app.ts`) is attached conditionally at BOTH passes —
 * `...(handler ? { callbacks: [handler] } : {})` — so the no-handler call
 * options stay byte-identical to before this change. The trace `metadata`
 * still carries ONLY safe fields (feature/provider/model), and the masked
 * (never raw) prompt is what the callback observes, so health text never
 * reaches the observability backend unmasked.
 */

/**
 * Minimal LangChain chat-model surface the adapter needs (real models + test
 * fakes satisfy it): a plain `stream()` for Pass 1 and a
 * `withStructuredOutput(...).invoke()` for Pass 2.
 */
export interface ExtractionChatModel {
  // `options` is a loose `Record<string, unknown>` (mirroring `invokeChain`'s
  // `chain.invoke` parameter in `adapter-factory.ts`) rather than the stricter
  // `ExtractionCallOptions`, so real provider classes (whose own call-options
  // types declare `callbacks?: Callbacks` from `@langchain/core`) stay
  // structurally assignable to this interface without importing that type here.
  stream(
    input: string,
    options?: Record<string, unknown>,
  ): Promise<AsyncIterable<{ content: unknown }>>;
  withStructuredOutput(
    schema: unknown,
    opts: { method: string },
  ): { invoke(input: string, options?: Record<string, unknown>): Promise<unknown> };
}

/** Call options forwarded to the model — abort + safe (masked) observability metadata. */
export interface ExtractionCallOptions {
  signal?: AbortSignal;
  runName?: string;
  metadata?: Record<string, unknown>;
  /**
   * Present only when a tracing handler is injected (langfuse-prompt-management,
   * slice A2), attached with the same conditional spread `invokeChain` uses.
   */
  callbacks?: unknown[];
}

/** Builds a chat model for a resolved provider/model config. Injected for testability. */
export type ExtractionModelFactory = (config: { provider: string; model: string }) => ExtractionChatModel;

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

const RUN_NAME = "plan-chat-extraction";
const FEATURE = "plan-chat-extraction";

/** Coerce a LangChain message-chunk `content` (string | complex parts) to plain text. */
function chunkText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const t = (part as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * Production model factory. Builds the provider-specific chat model, matching
 * the provider switch in `adapter-factory.ts`. Keys are read at call time (never
 * at construction), so an absent key does not crash boot — only a live call
 * fails. Unknown providers fall back to OpenRouter.
 */
export function buildExtractionModelFactory(): ExtractionModelFactory {
  return ({ provider, model }) => {
    switch (provider) {
      case "openai":
        return new ChatOpenAI({ apiKey: process.env["OPENAI_API_KEY"] ?? "placeholder-key", model });
      case "anthropic":
        return new ChatAnthropic({
          apiKey: process.env["ANTHROPIC_API_KEY"] ?? "placeholder-key",
          model,
        });
      case "google":
        return new ChatGoogleGenerativeAI({
          apiKey: process.env["GOOGLE_GENERATIVE_AI_API_KEY"] ?? "placeholder-key",
          model,
        });
      case "opencode-go":
        return new ChatOpenAI({
          apiKey: process.env["OPENCODE_GO_API_KEY"] ?? "placeholder-key",
          model,
          configuration: { baseURL: OPENCODE_GO_BASE_URL },
        });
      case "openrouter":
      default:
        return new ChatOpenAI({
          apiKey: process.env["OPENROUTER_API_KEY"] ?? "placeholder-key",
          model,
          configuration: {
            baseURL: OPENROUTER_BASE_URL,
            defaultHeaders: {
              "HTTP-Referer": process.env["WEB_PUBLIC_ORIGIN"] ?? "https://kinora.app",
              "X-Title": "kInorA",
            },
          },
        });
    }
  };
}

export class PlanSpecExtractionAdapter implements PlanSpecExtractor {
  constructor(
    private readonly configRepo: DynamicConfigRepo,
    private readonly modelFactory: ExtractionModelFactory,
    private readonly deps?: AiTracingDeps,
  ) {}

  /** Resolve provider/model per turn (mirrors DynamicPlanGenerator) and build a fresh model. */
  private async resolve(): Promise<{
    model: ExtractionChatModel;
    metadata: Record<string, unknown>;
  }> {
    const config = await this.configRepo.getActive();
    const provider = config?.provider ?? "openrouter";
    const model =
      config?.model ?? process.env["OPENROUTER_MODEL"] ?? "openai/gpt-4o-mini";
    return {
      model: this.modelFactory({ provider, model }),
      // Safe observability metadata ONLY — no raw message, no limitation text.
      metadata: { feature: FEATURE, provider, model },
    };
  }

  async *streamReply(input: ChatExtractInput, signal: AbortSignal): AsyncIterable<string> {
    if (signal.aborted) return;
    const { model, metadata } = await this.resolve();
    // buildReplyPrompt masks all KNOWN limitation terms before the model
    // (and hence any observability) sees them.
    const prompt = buildReplyPrompt(input);
    // `signal` is threaded into the LangChain call options so an external abort
    // — a wall-clock timeout OR client disconnect firing mid-turn — cancels this
    // in-flight streaming round-trip instead of blocking on the provider.
    const handler = this.deps?.handler;
    const stream = await model.stream(prompt, {
      signal,
      runName: RUN_NAME,
      metadata,
      ...(handler ? { callbacks: [handler] } : {}),
    });
    for await (const chunk of stream) {
      if (signal.aborted) return;
      const text = chunkText(chunk.content);
      if (text) yield text;
    }
  }

  async extract(
    input: ChatExtractInput,
    assistantReply: string,
    signal?: AbortSignal,
  ): Promise<PlanSpecDraft> {
    const { model, metadata } = await this.resolve();
    // The Pass-2 prompt is SEEDED with Pass 1's reply so the extraction is
    // consistent with what the assistant just told the user. Masking still
    // scrubs known limitation terms everywhere, including inside the reply.
    const prompt = buildExtractionPrompt(input, assistantReply);
    const chain = model.withStructuredOutput(PlanSpecDraftSchema, { method: "jsonSchema" });
    // Forward `signal` into the LangChain call options (the same `{ signal }`
    // shape `.stream()` accepts) so an external abort — a wall-clock timeout OR
    // client disconnect firing DURING Pass 2 — actually cancels this in-flight
    // structured-output round-trip instead of the caller blocking until the
    // provider responds.
    const handler = this.deps?.handler;
    const raw = await chain.invoke(prompt, {
      signal,
      runName: RUN_NAME,
      metadata,
      ...(handler ? { callbacks: [handler] } : {}),
    });
    // Re-parse at the boundary: never trust the model to honor the allow-list.
    // A forbidden key (preferenceScores/confirmed) or bad value is stripped/rejected here.
    return PlanSpecDraftSchema.parse(raw);
  }
}
