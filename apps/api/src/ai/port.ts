import type { PlanSpec, WorkoutProgram } from "@kinora/contracts";

/**
 * Hexagonal port for AI plan generation.
 *
 * Implementors:
 * - `OpenRouterPlanGenerator` (PR5) — calls OpenRouter via LangChain
 * - `MockPlanGenerator` (PR4) — deterministic, no network; used in tests
 *
 * No external imports beyond `@kinora/contracts` — this is the boundary layer.
 */
export interface PlanGenerator {
  generate(spec: PlanSpec): Promise<WorkoutProgram>;
}
