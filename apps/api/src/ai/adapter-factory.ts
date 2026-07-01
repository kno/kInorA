import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { CallbackHandler } from "langfuse-langchain";
import { WorkoutProgramSchema } from "@kinora/contracts";
import type { PlanSpec, WorkoutProgram } from "@kinora/contracts";
import type { PlanGenerator } from "./port.js";
import { buildPlanPrompt } from "./prompt.js";
import { mask } from "./mask.js";
import type { AdapterFactoryMap } from "./dynamic-generator.js";

type LangfuseHandlerWithFlush = CallbackHandler & {
  flushAsync?: () => Promise<void>;
  flush?: () => Promise<void>;
  shutdownAsync?: () => Promise<void>;
};

interface InvokeChainMetadata {
  provider: string;
  model: string;
}

/**
 * Base URL for OpenRouter.
 * Used by the openrouter adapter.
 */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Base URL for OpenCode-Go.
 * Used by the opencode-go adapter.
 */
const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

function ensureLangfuseBaseUrlEnv(): void {
  if (!process.env["LANGFUSE_BASEURL"] && process.env["LANGFUSE_HOST"]) {
    process.env["LANGFUSE_BASEURL"] = process.env["LANGFUSE_HOST"];
  }
}

async function flushLangfuseHandler(handler: LangfuseHandlerWithFlush): Promise<void> {
  const flush = handler.flushAsync ?? handler.flush ?? handler.shutdownAsync;
  if (flush) {
    await flush.call(handler);
  }
}

/**
 * Shared invoke logic for all adapters.
 * Builds the prompt from the spec, masks health data (limitations),
 * and invokes the chain with the Langfuse callback handler.
 *
 * All adapters MUST mask limitation text BEFORE sending to LangChain
 * to prevent health data from appearing in Langfuse traces (AGENTS.md §72).
 */
async function invokeChain(
  chain: { invoke(input: string, options: Record<string, unknown>): Promise<unknown> },
  spec: PlanSpec,
  metadata: InvokeChainMetadata
): Promise<WorkoutProgram> {
  ensureLangfuseBaseUrlEnv();

  const traceMetadata = {
    feature: "plan-generation",
    provider: metadata.provider,
    model: metadata.model,
  };
  const langfuseHandler = new CallbackHandler({
    tags: ["plan-generation"],
    metadata: traceMetadata,
  }) as LangfuseHandlerWithFlush;

  const rawPrompt = buildPlanPrompt(spec);
  const limitationTerms = spec.limitations.map((l) => l.text);
  const maskedPrompt = mask(rawPrompt, limitationTerms);

  let raw: unknown;
  try {
    raw = await chain.invoke(maskedPrompt, {
      callbacks: [langfuseHandler],
      runName: "plan-generation",
      metadata: traceMetadata,
    });
  } finally {
    await flushLangfuseHandler(langfuseHandler);
  }

  return WorkoutProgramSchema.parse(raw);
}

/**
 * OpenRouter adapter factory.
 * Wraps the existing OpenRouter pattern: ChatOpenAI + baseURL.
 * Reads OPENROUTER_API_KEY at call time (not construction time).
 */
function createOpenRouterAdapter(model: string): PlanGenerator {
  const llm = new ChatOpenAI({
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

  const chain = llm.withStructuredOutput(WorkoutProgramSchema, { method: "jsonSchema" });

  return {
    generate(spec: PlanSpec): Promise<WorkoutProgram> {
      return invokeChain(chain, spec, { provider: "openrouter", model });
    },
  };
}

/**
 * OpenAI adapter factory.
 * Uses the standard ChatOpenAI without a baseURL override.
 * Reads OPENAI_API_KEY at call time.
 */
function createOpenAIAdapter(model: string): PlanGenerator {
  const llm = new ChatOpenAI({
    apiKey: process.env["OPENAI_API_KEY"] ?? "placeholder-key",
    model,
  });

  const chain = llm.withStructuredOutput(WorkoutProgramSchema, { method: "jsonSchema" });

  return {
    generate(spec: PlanSpec): Promise<WorkoutProgram> {
      return invokeChain(chain, spec, { provider: "openai", model });
    },
  };
}

/**
 * Anthropic adapter factory.
 * Uses @langchain/anthropic ChatAnthropic.
 * Reads ANTHROPIC_API_KEY at call time.
 */
function createAnthropicAdapter(model: string): PlanGenerator {
  const llm = new ChatAnthropic({
    apiKey: process.env["ANTHROPIC_API_KEY"] ?? "placeholder-key",
    model,
  });

  const chain = llm.withStructuredOutput(WorkoutProgramSchema, { method: "jsonSchema" });

  return {
    generate(spec: PlanSpec): Promise<WorkoutProgram> {
      return invokeChain(chain, spec, { provider: "anthropic", model });
    },
  };
}

/**
 * Google Generative AI adapter factory.
 * Uses @langchain/google-genai ChatGoogleGenerativeAI.
 * Reads GOOGLE_GENERATIVE_AI_API_KEY at call time.
 */
function createGoogleAdapter(model: string): PlanGenerator {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env["GOOGLE_GENERATIVE_AI_API_KEY"] ?? "placeholder-key",
    model,
  });

  const chain = llm.withStructuredOutput(WorkoutProgramSchema, { method: "jsonSchema" });

  return {
    generate(spec: PlanSpec): Promise<WorkoutProgram> {
      return invokeChain(chain, spec, { provider: "google", model });
    },
  };
}

/**
 * OpenCode-Go adapter factory.
 * Uses ChatOpenAI with the OpenCode baseURL.
 * Reads OPENCODE_GO_API_KEY at call time.
 *
 * NOTE: uses method "json_mode" (response_format: json_object) instead of
 * "jsonSchema" (response_format: json_schema). DeepSeek models on OpenCode-Go
 * return HTTP 400 "This response_format type is unavailable now" when sent a
 * json_schema structured output request. json_mode works correctly and the
 * response is parsed against WorkoutProgramSchema by invokeChain.
 */
function createOpenCodeGoAdapter(model: string): PlanGenerator {
  const llm = new ChatOpenAI({
    apiKey: process.env["OPENCODE_GO_API_KEY"] ?? "placeholder-key",
    model,
    configuration: {
      baseURL: OPENCODE_GO_BASE_URL,
    },
  });

  const chain = llm.withStructuredOutput(WorkoutProgramSchema, { method: "jsonMode" });

  return {
    generate(spec: PlanSpec): Promise<WorkoutProgram> {
      return invokeChain(chain, spec, { provider: "opencode-go", model });
    },
  };
}

/**
 * Build the production adapter factory map.
 *
 * Each entry is a factory function: (model: string) => PlanGenerator.
 * The DynamicPlanGenerator selects the factory by provider name at generate() time.
 *
 * All adapters:
 * - Do NOT throw at construction when API keys are absent (key read at call time)
 * - Use .withStructuredOutput(WorkoutProgramSchema, { method: "jsonSchema" })
 * - Mask limitation text before the prompt reaches LangChain/Langfuse
 */
export function buildAdapters(): AdapterFactoryMap {
  return {
    openrouter: createOpenRouterAdapter,
    openai: createOpenAIAdapter,
    anthropic: createAnthropicAdapter,
    google: createGoogleAdapter,
    "opencode-go": createOpenCodeGoAdapter,
  };
}
