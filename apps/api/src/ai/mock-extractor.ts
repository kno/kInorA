import type { PlanSpecDraft } from "@kinora/contracts";
import type { ChatExtractInput, PlanSpecExtractor } from "./extraction-port.js";

/**
 * Deterministic mock implementation of `PlanSpecExtractor` (mirrors
 * `MockPlanGenerator`).
 *
 * `streamReply` yields a deterministic token stream (the assistant prose);
 * `extract` returns a structurally valid `PlanSpecDraft` from a keyword scan of
 * the user message — all WITHOUT any network call, API key, or LLM dependency.
 * Used by route/service tests (S2+) that need an extractor without real LLM
 * infrastructure. It intentionally does NOT import LangChain — the real adapter
 * (S2b) owns that dependency.
 *
 * Determinism guarantee: same input → same output on every call, from any
 * instance. No random values, no timestamps, no external state. Extraction is a
 * simple, deterministic keyword scan — NOT a real NLU — sufficient for tests.
 */

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};

/** Deterministic assistant prose, emitted token-by-token by `streamTurn`. */
export const REPLY_TOKENS: readonly string[] = [
  "Got ",
  "it — ",
  "I've ",
  "updated ",
  "your ",
  "plan ",
  "draft.",
];

const EQUIPMENT_TERMS: readonly string[] = [
  "dumbbells",
  "dumbbell",
  "barbell",
  "kettlebell",
  "kettlebells",
  "resistance band",
  "resistance bands",
  "pull-up bar",
  "bench",
  "machine",
];

function extractGoal(text: string): PlanSpecDraft["goal"] {
  if (/\b(hypertroph|build muscle|muscle|bulk)\b/i.test(text)) return "hypertrophy";
  if (/\bstrength|stronger\b/i.test(text)) return "strength";
  if (/\b(fat loss|lose (weight|fat)|weight loss|slim down)\b/i.test(text)) return "fat_loss";
  if (/\b(get fit|general fitness|stay fit|fitness)\b/i.test(text)) return "general_fitness";
  return undefined;
}

function extractDaysPerWeek(text: string): number | undefined {
  const digit = text.match(/(\d+)\s*(?:days?|x)\b/i);
  if (digit && digit[1]) {
    const value = Number.parseInt(digit[1], 10);
    if (value >= 1 && value <= 7) return value;
  }
  const word = text.match(/\b(one|two|three|four|five|six|seven)\s*days?\b/i);
  if (word && word[1]) return NUMBER_WORDS[word[1].toLowerCase()];
  return undefined;
}

function extractDuration(text: string): number | undefined {
  const match = text.match(/(\d+)\s*(?:min|mins|minutes)\b/i);
  if (match && match[1]) {
    const value = Number.parseInt(match[1], 10);
    if (value >= 15 && value <= 240) return value;
  }
  return undefined;
}

function extractLocation(text: string): PlanSpecDraft["location"] {
  if (/\bgym\b/i.test(text)) return "gym";
  if (/\bhome\b/i.test(text)) return "home";
  if (/\boutdoor|outside\b/i.test(text)) return "outdoor";
  return undefined;
}

function extractEquipment(text: string): string[] | undefined {
  const found: string[] = [];
  for (const term of EQUIPMENT_TERMS) {
    const normalized = term.endsWith("s") ? term : `${term}s`;
    if (new RegExp(`\\b${term}\\b`, "i").test(text) && !found.includes(normalized)) {
      found.push(normalized);
    }
  }
  return found.length > 0 ? found : undefined;
}

export class MockPlanSpecExtractor implements PlanSpecExtractor {
  async *streamReply(_input: ChatExtractInput, signal: AbortSignal): AsyncIterable<string> {
    for (const token of REPLY_TOKENS) {
      if (signal.aborted) return;
      yield token;
    }
  }

  /**
   * Deterministic keyword scan of the USER message → the six-field draft (NOT a
   * real NLU). `assistantReply` is accepted to satisfy the port signature (the
   * real adapter seeds Pass 2 with it) but the mock ignores it — the keyword
   * scan is over `input.message` only, keeping the mock fully deterministic.
   */
  async extract(input: ChatExtractInput, _assistantReply: string): Promise<PlanSpecDraft> {
    return this.extractDraft(input.message);
  }

  /** Deterministic keyword scan → the six-field draft (NOT a real NLU). */
  private extractDraft(text: string): PlanSpecDraft {
    const draft: PlanSpecDraft = {};

    const goal = extractGoal(text);
    if (goal !== undefined) draft.goal = goal;

    const daysPerWeek = extractDaysPerWeek(text);
    if (daysPerWeek !== undefined) draft.daysPerWeek = daysPerWeek;

    const sessionDurationMinutes = extractDuration(text);
    if (sessionDurationMinutes !== undefined) draft.sessionDurationMinutes = sessionDurationMinutes;

    const location = extractLocation(text);
    if (location !== undefined) draft.location = location;

    const equipment = extractEquipment(text);
    if (equipment !== undefined) draft.equipment = equipment;

    return draft;
  }
}
