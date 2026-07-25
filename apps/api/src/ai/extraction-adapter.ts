import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { PlanSpecDraftSchema } from "@kinora/contracts";
import type { PlanSpecDraft } from "@kinora/contracts";
import type { ChatExtractInput, PlanSpecExtractor } from "./extraction-port.js";
import { buildExtractionPrompt } from "./extraction-prompt.js";
import type { DynamicConfigRepo } from "./dynamic-generator.js";

/**
 * LangChain-backed extraction adapter for the conversational create-plan turn
 * (12-v1.1-interactive-text-chat, S2b).
 *
 * This is the ONLY place the LangChain dependency enters the chat path — the
 * route (`plan.ts`) depends on the `PlanSpecExtractor` port, never on LangChain,
 * so the deps-guard/architecture confinement (LLM code lives only under
 * `apps/api/src/ai/`) holds.
 *
 * Two passes per turn (design.md):
 *   - Pass 1 `streamReply()` — streams the assistant PROSE token-by-token via the
 *     model's `.stream()`, honoring the `AbortSignal` (client disconnect / server
 *     timeout aborts the underlying LLM stream).
 *   - Pass 2 `extract()` — a terminal, non-streamed structured extraction via
 *     `withStructuredOutput(PlanSpecDraftSchema, { method: "jsonSchema" })`,
 *     mirroring the proven generation adapter (`adapter-factory.ts`). The result
 *     is re-parsed with `PlanSpecDraftSchema` at this boundary so a forbidden or
 *     malformed key can never leak past the adapter.
 *
 * Provider selection mirrors `DynamicPlanGenerator`: the active provider/model is
 * read from the DB config on EVERY call and a fresh model is built via the
 * injected factory. Tests inject a deterministic fake factory — no network.
 *
 * OBSERVABILITY / MASKING (S1 TODO(S2b) closed here): the prompt handed to the
 * model is `buildExtractionPrompt()` output, which masks ALL already-known
 * limitation/health terms via `mask()` (a first-mention phrase is unavoidably
 * present — it is the minimal exposure the extraction needs, see
 * `extraction-prompt.ts`). Crucially, NO input-capturing callback handler is
 * attached and the trace `metadata` carries ONLY safe fields
 * (feature/provider/model) — never the raw message or limitation text — exactly
 * as `invokeChain` does for generation. Health text therefore never reaches the
 * observability backend.
 */

/** Minimal LangChain chat-model surface the adapter needs (real models + test fakes satisfy it). */
export interface ExtractionChatModel {
  stream(input: string, options?: ExtractionCallOptions): Promise<AsyncIterable<{ content: unknown }>>;
  withStructuredOutput(
    schema: unknown,
    opts: { method: string },
  ): { invoke(input: string, options?: ExtractionCallOptions): Promise<unknown> };
}

/** Call options forwarded to the model — abort + safe (masked) observability metadata. */
export interface ExtractionCallOptions {
  signal?: AbortSignal;
  runName?: string;
  metadata?: Record<string, unknown>;
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
    // buildExtractionPrompt masks all KNOWN limitation terms before the model
    // (and hence any observability) sees them.
    const prompt = buildExtractionPrompt(input);
    const stream = await model.stream(prompt, { signal, runName: RUN_NAME, metadata });
    for await (const chunk of stream) {
      if (signal.aborted) return;
      const text = chunkText(chunk.content);
      if (text) yield text;
    }
  }

  async extract(input: ChatExtractInput): Promise<PlanSpecDraft> {
    const { model, metadata } = await this.resolve();
    const prompt = buildExtractionPrompt(input);
    const chain = model.withStructuredOutput(PlanSpecDraftSchema, { method: "jsonSchema" });
    const raw = await chain.invoke(prompt, { runName: RUN_NAME, metadata });
    // Re-parse at the boundary: never trust the model to honor the allow-list.
    // A forbidden key (preferenceScores/confirmed) or bad value is stripped/rejected here.
    return PlanSpecDraftSchema.parse(raw);
  }
}
