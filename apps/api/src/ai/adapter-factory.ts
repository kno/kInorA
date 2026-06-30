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

/**
 * Shared invoke logic for all adapters.
 * Builds the prompt from the spec, masks health data (limitations),
 * and invokes the chain with the Langfuse callback handler.
 *
 * All adapters MUST mask limitation text BEFORE sending to LangChain
 * to prevent health data from appearing in Langfuse traces (AGENTS.md §72).
 */
async function invokeChain(
  chain: { invoke(input: string, options: { callbacks: CallbackHandler[] }): Promise<unknown> },
  spec: PlanSpec
): Promise<WorkoutProgram> {
  const langfuseHandler = new CallbackHandler();

  const rawPrompt = buildPlanPrompt(spec);
  const limitationTerms = spec.limitations.map((l) => l.text);
  const maskedPrompt = mask(rawPrompt, limitationTerms);

  const raw = await chain.invoke(maskedPrompt, {
    callbacks: [langfuseHandler],
  });

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
      return invokeChain(chain, spec);
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
      return invokeChain(chain, spec);
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
      return invokeChain(chain, spec);
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
      return invokeChain(chain, spec);
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

  const chain = llm.withStructuredOutput(WorkoutProgramSchema, { method: "json_mode" });

  return {
    generate(spec: PlanSpec): Promise<WorkoutProgram> {
      return invokeChain(chain, spec);
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
