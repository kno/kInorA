import { ChatOpenAI } from "@langchain/openai";
import type { Runnable } from "@langchain/core/runnables";
import { CallbackHandler } from "langfuse-langchain";
import { WorkoutProgramSchema } from "@kinora/contracts";
import type { PlanSpec, WorkoutProgram } from "@kinora/contracts";
import type { PlanGenerator } from "./port.js";
import { buildPlanPrompt } from "./prompt.js";
import { mask } from "./mask.js";

/**
 * Emit a one-time startup warning when OPENROUTER_API_KEY is absent or blank.
 *
 * Call this ONCE at application boot (e.g. in buildApp or index.ts) — not per request.
 * Accepts an env map so it is pure-ish and trivially testable without process.env mutation.
 *
 * @param env  A record of environment variables (default: process.env)
 */
export function warnIfAiConfigMissing(env: Record<string, string | undefined> = process.env): void {
  if (!env["OPENROUTER_API_KEY"]?.trim()) {
    console.warn(
      "[startup] OPENROUTER_API_KEY is not set — AI plan generation will fail at call time"
    );
  }
}

/**
 * OpenRouter LLM adapter implementing the `PlanGenerator` port.
 *
 * Routes generation requests to any model supported by OpenRouter via
 * LangChain's OpenAI-compatible `ChatOpenAI` client.
 *
 * Observability: Langfuse tracing is wired via the `CallbackHandler`. The
 * handler is a NO-OP when `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` are
 * not set (CI/dev safe). All `PlanSpec.limitations` text is masked with
 * `[REDACTED]` BEFORE the prompt reaches LangChain (and therefore before
 * it appears in any Langfuse trace) — health data must not be logged
 * (AGENTS.md §72).
 *
 * Structured output method: `"jsonSchema"` — preferred over `"functionCalling"`
 * because OpenRouter routes across many providers and not all of them support
 * the tool/function-calling protocol. JSON-schema mode is more broadly
 * compatible and still produces Zod-validated output via LangChain's
 * `.withStructuredOutput`. NOTE: the chosen `OPENROUTER_MODEL` must still
 * support JSON-schema-mode structured output (see AGENTS.md / README env docs).
 *
 * Construction: does NOT throw when `OPENROUTER_API_KEY` is absent — the key
 * is read at call time. Only `.generate()` will throw if the key is missing
 * or invalid. This keeps unit tests and CI safe without any env vars.
 */
export class OpenRouterPlanGenerator implements PlanGenerator {
  private readonly chain: Runnable;
  private readonly langfuseHandler: CallbackHandler;

  constructor() {
    this.langfuseHandler = new CallbackHandler();

    const model = new ChatOpenAI({
      apiKey: process.env["OPENROUTER_API_KEY"] ?? "placeholder-key",
      model: process.env["OPENROUTER_MODEL"] ?? "openai/gpt-4o-mini",
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": process.env["WEB_PUBLIC_ORIGIN"] ?? "https://kinora.app",
          "X-Title": "kInorA",
        },
      },
    });

    // Use "jsonSchema" method — broadest model compatibility on OpenRouter.
    // See class-level JSDoc for rationale.
    this.chain = model.withStructuredOutput(WorkoutProgramSchema, {
      method: "jsonSchema",
    });
  }

  async generate(spec: PlanSpec): Promise<WorkoutProgram> {
    // Build the prompt from the spec
    const rawPrompt = buildPlanPrompt(spec);

    // Mask limitation text BEFORE the prompt reaches LangChain or Langfuse.
    // Limitations are health data and must never appear in traces (AGENTS.md §72).
    const limitationTerms = spec.limitations.map((l) => l.text);
    const maskedPrompt = mask(rawPrompt, limitationTerms);

    const raw = await this.chain.invoke(maskedPrompt, {
      callbacks: [this.langfuseHandler],
    });

    // Explicit Zod parse — do NOT bare-cast with `as WorkoutProgram`.
    // LangChain's internal validation is not a substitute for an explicit
    // parse at the adapter boundary. A ZodError here propagates to the
    // PR6 generation service, which catches it and calls markFailed —
    // preventing malformed model output from reaching the domain steps.
    return WorkoutProgramSchema.parse(raw);
  }
}
