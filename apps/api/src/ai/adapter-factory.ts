import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { WorkoutProgramSchema } from "@kinora/contracts";
import type { PlanSpec, WorkoutProgram } from "@kinora/contracts";
import type { PlanGenerator } from "./port.js";
import { buildPlanPrompt } from "./prompt.js";
import { mask } from "./mask.js";
import type { AdapterFactoryMap } from "./dynamic-generator.js";
import type { AiTracingDeps } from "./langfuse-handler.js";

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

/**
 * Shared invoke logic for all adapters.
 * Builds the prompt from the spec and masks health data before provider delivery.
 *
 * Superseded (langfuse-prompt-management, slice A1): this used to attach no
 * callback, because callbacks receive raw structured model output before this
 * boundary can validate or redact it. That rationale is deliberately
 * overridden now, with three compensating controls that keep the payload
 * safe: (a) limitation text is masked on the way IN, before `.invoke`; (b)
 * the traced output is a `WorkoutProgramSchema`-shaped program with no
 * limitation-bearing field; (c) the masking-payload test below asserts every
 * value the callback observes — input and output — is free of unmasked
 * limitation terms. The handler is injected via `deps.handler` and attached
 * conditionally, so the no-handler invoke config stays byte-identical to
 * today's when tracing is off.
 */
async function invokeChain(
  chain: { invoke(input: string, options: Record<string, unknown>): Promise<unknown> },
  spec: PlanSpec,
  metadata: InvokeChainMetadata,
  deps?: AiTracingDeps
): Promise<WorkoutProgram> {
  const traceMetadata = {
    feature: "plan-generation",
    provider: metadata.provider,
    model: metadata.model,
  };
  const rawPrompt = buildPlanPrompt(spec);
  const limitationTerms = spec.limitations.map((l) => l.text);
  const maskedPrompt = mask(rawPrompt, limitationTerms);

  const handler = deps?.handler;
  const raw = await chain.invoke(maskedPrompt, {
    runName: "plan-generation",
    metadata: traceMetadata,
    ...(handler ? { callbacks: [handler] } : {}),
  });

  return WorkoutProgramSchema.parse(raw);
}

/**
 * OpenRouter adapter factory.
 * Wraps the existing OpenRouter pattern: ChatOpenAI + baseURL.
 * Reads OPENROUTER_API_KEY at call time (not construction time).
 */
function createOpenRouterAdapter(model: string, deps?: AiTracingDeps): PlanGenerator {
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
      return invokeChain(chain, spec, { provider: "openrouter", model }, deps);
    },
  };
}

/**
 * OpenAI adapter factory.
 * Uses the standard ChatOpenAI without a baseURL override.
 * Reads OPENAI_API_KEY at call time.
 */
function createOpenAIAdapter(model: string, deps?: AiTracingDeps): PlanGenerator {
  const llm = new ChatOpenAI({
    apiKey: process.env["OPENAI_API_KEY"] ?? "placeholder-key",
    model,
  });

  const chain = llm.withStructuredOutput(WorkoutProgramSchema, { method: "jsonSchema" });

  return {
    generate(spec: PlanSpec): Promise<WorkoutProgram> {
      return invokeChain(chain, spec, { provider: "openai", model }, deps);
    },
  };
}

/**
 * Anthropic adapter factory.
 * Uses @langchain/anthropic ChatAnthropic.
 * Reads ANTHROPIC_API_KEY at call time.
 */
function createAnthropicAdapter(model: string, deps?: AiTracingDeps): PlanGenerator {
  const llm = new ChatAnthropic({
    apiKey: process.env["ANTHROPIC_API_KEY"] ?? "placeholder-key",
    model,
  });

  const chain = llm.withStructuredOutput(WorkoutProgramSchema, { method: "jsonSchema" });

  return {
    generate(spec: PlanSpec): Promise<WorkoutProgram> {
      return invokeChain(chain, spec, { provider: "anthropic", model }, deps);
    },
  };
}

/**
 * Google Generative AI adapter factory.
 * Uses @langchain/google-genai ChatGoogleGenerativeAI.
 * Reads GOOGLE_GENERATIVE_AI_API_KEY at call time.
 */
function createGoogleAdapter(model: string, deps?: AiTracingDeps): PlanGenerator {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env["GOOGLE_GENERATIVE_AI_API_KEY"] ?? "placeholder-key",
    model,
  });

  const chain = llm.withStructuredOutput(WorkoutProgramSchema, { method: "jsonSchema" });

  return {
    generate(spec: PlanSpec): Promise<WorkoutProgram> {
      return invokeChain(chain, spec, { provider: "google", model }, deps);
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
function createOpenCodeGoAdapter(model: string, deps?: AiTracingDeps): PlanGenerator {
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
      return invokeChain(chain, spec, { provider: "opencode-go", model }, deps);
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
 *
 * `deps` (langfuse-prompt-management, slice A1) threads the optional Langfuse
 * tracing handler into every adapter's `invokeChain` call. Omitting `deps`
 * (or `deps.handler`) keeps the invoke config byte-identical to before this
 * change — no `callbacks` key is ever added when no handler is injected.
 */
export function buildAdapters(deps?: AiTracingDeps): AdapterFactoryMap {
  return {
    openrouter: (model: string) => createOpenRouterAdapter(model, deps),
    openai: (model: string) => createOpenAIAdapter(model, deps),
    anthropic: (model: string) => createAnthropicAdapter(model, deps),
    google: (model: string) => createGoogleAdapter(model, deps),
    "opencode-go": (model: string) => createOpenCodeGoAdapter(model, deps),
  };
}
