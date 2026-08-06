import type { PlanSpec, WorkoutProgram } from "@kinora/contracts";

/**
 * Hexagonal port for AI plan generation.
 *
 * Implementors:
 * - The `adapter-factory.ts` provider factories (openrouter, openai,
 *   anthropic, google, opencode-go) — all call their respective LLM via
 *   LangChain's `invokeChain` choke point (langfuse-prompt-management).
 * - `MockPlanGenerator` (PR4) — deterministic, no network; used in tests
 *
 * No external imports beyond `@kinora/contracts` — this is the boundary layer.
 */
export interface PlanGenerator {
  generate(spec: PlanSpec): Promise<WorkoutProgram>;
}
