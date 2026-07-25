import type { PlanSpecDraft, PlanSpecDraftField } from "@kinora/contracts";

/**
 * Input for a single conversational create-plan turn (12-interactive-text-chat).
 *
 * `currentDraft` is the shared `plan_drafts.spec_json` state; `message` is the
 * user's free text this turn; `missingFields` steers deterministic clarifying
 * questions; `memoryContext` is optional approved user memory (sanitized before
 * the LLM sees it). Tenant/user scoping lives at the route boundary, never here.
 */
export interface ChatExtractInput {
  message: string;
  currentDraft: PlanSpecDraft;
  missingFields?: PlanSpecDraftField[];
  memoryContext?: string[];
}

/**
 * Hexagonal port for the per-turn plan-spec extraction (mirrors `PlanGenerator`).
 *
 * Implementors:
 * - `PlanSpecExtractionAdapter` (S2b) — LangChain `.stream()` prose + terminal
 *   `withStructuredOutput(PlanSpecDraftSchema)` extraction.
 * - `MockPlanSpecExtractor` (S1) — deterministic, no network; used in tests.
 *
 * `streamReply` yields the assistant prose token-by-token and MUST honor the
 * `AbortSignal` (client disconnect). `extract` returns the terminal structured
 * `Partial<PlanSpec>` for one turn. No external imports beyond `@kinora/contracts`
 * — this is the boundary layer; adapters (S2b) own the LLM dependency.
 */
export interface PlanSpecExtractor {
  streamReply(input: ChatExtractInput, signal: AbortSignal): AsyncIterable<string>;
  extract(input: ChatExtractInput): Promise<PlanSpecDraft>;
}
