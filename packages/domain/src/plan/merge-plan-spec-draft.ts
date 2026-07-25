/**
 * Pure merge + per-field re-validation for the conversational create-plan draft
 * (12-v1.1-interactive-text-chat, S1).
 *
 * A chat turn yields a `Partial<PlanSpec>` (`PlanSpecDraft`) that may contain
 * hallucinated, out-of-range, or malformed values. This function is the
 * fail-safe boundary between untrusted extraction output and the persisted
 * draft: every extracted field is re-validated here (never trusting the caller),
 * invalid fields are dropped SILENTLY (the current value is preserved), valid
 * fields are merged, and `missingFields` reports which of the six required input
 * fields are still absent — driving deterministic clarifying questions.
 *
 * Pure and framework-free: no I/O, no mutation of the inputs, deterministic.
 * `preferenceScores` (derived server-side by `derivePreferenceScores`) and
 * `confirmed` are NEVER written, even if present on the untyped input.
 */

import type { PlanSpecDraft, PlanSpecDraftField } from "@kinora/contracts";
import { validateSessionDuration } from "./session-duration.js";

/**
 * The six required wizard INPUT fields, in canonical order. `name` is optional
 * and intentionally excluded — it never counts toward `missingFields`.
 */
export const PLAN_SPEC_DRAFT_INPUT_FIELDS = [
  "goal",
  "daysPerWeek",
  "sessionDurationMinutes",
  "location",
  "equipment",
  "limitations",
] as const satisfies readonly PlanSpecDraftField[];

// Enum value sets. Hardcoded to keep the domain free of any Zod/contract runtime
// dependency; they MUST mirror `PlanGoal` / `TrainingLocation` in
// `packages/contracts/src/index.ts`.
const PLAN_GOALS = ["strength", "hypertrophy", "fat_loss", "general_fitness"];
const TRAINING_LOCATIONS = ["home", "gym", "outdoor"];

const MIN_DAYS_PER_WEEK = 1;
const MAX_DAYS_PER_WEEK = 7;

function isValidGoal(value: unknown): boolean {
  return typeof value === "string" && PLAN_GOALS.includes(value);
}

function isValidLocation(value: unknown): boolean {
  return typeof value === "string" && TRAINING_LOCATIONS.includes(value);
}

function isValidDaysPerWeek(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_DAYS_PER_WEEK &&
    value <= MAX_DAYS_PER_WEEK
  );
}

function isValidDuration(value: unknown): boolean {
  return typeof value === "number" && validateSessionDuration(value).ok;
}

function isValidEquipment(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidLimitations(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { text?: unknown }).text === "string" &&
        typeof (item as { isWarning?: unknown }).isWarning === "boolean",
    )
  );
}

function isValidName(value: unknown): boolean {
  return value === null || typeof value === "string";
}

export interface MergePlanSpecDraftResult {
  /** The current draft with every VALID extracted field applied. */
  draft: PlanSpecDraft;
  /** Which of the six required input fields are still absent after the merge. */
  missingFields: PlanSpecDraftField[];
}

/**
 * Merge a per-turn extraction onto the current draft, re-validating each field.
 *
 * @param current   The draft as persisted today (`plan_drafts.spec_json`).
 * @param extracted The `Partial<PlanSpec>` produced by this turn's extraction.
 * @returns The merged draft plus the list of still-missing required input fields.
 */
export function mergePlanSpecDraft(
  current: PlanSpecDraft,
  extracted: PlanSpecDraft,
): MergePlanSpecDraftResult {
  // Copy only the allow-listed keys from `current` so a dirty persisted value
  // (e.g. a stray preferenceScores) can never leak through the merge either.
  const draft: PlanSpecDraft = {};
  if (current.goal !== undefined) draft.goal = current.goal;
  if (current.daysPerWeek !== undefined) draft.daysPerWeek = current.daysPerWeek;
  if (current.sessionDurationMinutes !== undefined)
    draft.sessionDurationMinutes = current.sessionDurationMinutes;
  if (current.location !== undefined) draft.location = current.location;
  if (current.equipment !== undefined) draft.equipment = current.equipment;
  if (current.limitations !== undefined) draft.limitations = current.limitations;
  if (current.name !== undefined) draft.name = current.name;

  if (isValidGoal(extracted.goal)) draft.goal = extracted.goal;
  if (isValidDaysPerWeek(extracted.daysPerWeek)) draft.daysPerWeek = extracted.daysPerWeek;
  if (isValidDuration(extracted.sessionDurationMinutes))
    draft.sessionDurationMinutes = extracted.sessionDurationMinutes;
  if (isValidLocation(extracted.location)) draft.location = extracted.location;
  if (isValidEquipment(extracted.equipment)) draft.equipment = extracted.equipment;
  if (isValidLimitations(extracted.limitations)) draft.limitations = extracted.limitations;
  if (extracted.name !== undefined && isValidName(extracted.name)) draft.name = extracted.name;

  const missingFields = PLAN_SPEC_DRAFT_INPUT_FIELDS.filter(
    (field) => draft[field] === undefined,
  );

  return { draft, missingFields };
}
