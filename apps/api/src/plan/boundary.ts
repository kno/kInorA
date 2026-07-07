import type { PlanSpec } from "@kinora/contracts";

/**
 * Maximum length of a plan `name` at the API boundary (#93). Mirrors the
 * `workout_plans.name` column (`VARCHAR(120)`) so an over-long name is rejected
 * as a clean 4xx at the boundary instead of blowing up the DB INSERT as a 500.
 * The name is trimmed BEFORE this bound is applied.
 */
export const PLAN_NAME_MAX_LENGTH = 120;

/**
 * Validates the optional plan `name` (#93). When present it must be a string or
 * null; a string is bounded to PLAN_NAME_MAX_LENGTH after trimming (the DB
 * column is VARCHAR(120)). Absent is valid (legacy specs and callers that never
 * set it). Throws with a descriptive message on violation.
 *
 * Shared by both assertPlanSpecInput (raw wizard input) and assertPlanSpecShape
 * (full confirmed spec) so the length guarantee holds at whichever boundary the
 * route actually calls.
 */
function assertPlanName(name: unknown): void {
  if (name === undefined || name === null) {
    return;
  }
  if (typeof name !== "string") {
    throw new Error("PlanSpec.name must be a string or null when present");
  }
  if (name.trim().length > PLAN_NAME_MAX_LENGTH) {
    throw new Error(
      `PlanSpec.name must be at most ${PLAN_NAME_MAX_LENGTH} characters`
    );
  }
}

/**
 * Validates the wizard input fields common to both assertPlanSpecInput and
 * assertPlanSpecShape: goal, daysPerWeek, sessionDurationMinutes, location,
 * equipment (string[]), and limitations (PlanLimitation[]).
 *
 * Throws on the first violation. Extracted so both guards share one impl.
 */
function assertInputFields(obj: Record<string, unknown>): void {
  if (typeof obj.goal !== "string") {
    throw new Error("PlanSpec.goal must be a string");
  }

  if (typeof obj.daysPerWeek !== "number") {
    throw new Error("PlanSpec.daysPerWeek must be a number");
  }

  if (typeof obj.sessionDurationMinutes !== "number") {
    throw new Error("PlanSpec.sessionDurationMinutes must be a number");
  }

  if (typeof obj.location !== "string") {
    throw new Error("PlanSpec.location must be a string");
  }

  if (!Array.isArray(obj.equipment)) {
    throw new Error("PlanSpec.equipment must be an array");
  }

  for (let i = 0; i < obj.equipment.length; i++) {
    if (typeof obj.equipment[i] !== "string") {
      throw new Error(`PlanSpec.equipment[${i}] must be a string`);
    }
  }

  if (!Array.isArray(obj.limitations)) {
    throw new Error("PlanSpec.limitations must be an array");
  }

  for (let i = 0; i < obj.limitations.length; i++) {
    const limitation = obj.limitations[i] as unknown;
    if (typeof limitation !== "object" || limitation === null) {
      throw new Error(
        `PlanSpec.limitations[${i}] must be an object with {text: string, isWarning: boolean}`
      );
    }
    const lim = limitation as Record<string, unknown>;
    if (typeof lim.text !== "string") {
      throw new Error(`PlanSpec.limitations[${i}].text must be a string`);
    }
    if (typeof lim.isWarning !== "boolean") {
      throw new Error(`PlanSpec.limitations[${i}].isWarning must be a boolean`);
    }
  }

  // Optional plan name (#93) — validated in the shared input fields so BOTH
  // assertPlanSpecInput (the raw wizard draft the route promotes) and
  // assertPlanSpecShape (the full confirmed spec) enforce the string|null type
  // and the VARCHAR(120) length bound at the boundary the route actually calls.
  assertPlanName(obj.name);
}

/**
 * Validates that an unknown input carries the wizard INPUT fields only:
 * goal, daysPerWeek, sessionDurationMinutes, location, equipment, limitations.
 *
 * Does NOT require preferenceScores or confirmed — those are server-derived
 * on promote. Use this in the promote handler BEFORE calling derivePreferenceScores.
 *
 * Returns without error when all input fields are present and correctly typed.
 * Throws with a descriptive message on the first violation.
 */
export function assertPlanSpecInput(input: unknown): void {
  if (typeof input !== "object" || input === null) {
    throw new Error("PlanSpec must be an object");
  }

  const obj = input as Record<string, unknown>;
  assertInputFields(obj);
}

/**
 * Validates that an unknown input has the structural shape of a PlanSpec.
 * Throws if required fields are missing or have wrong types.
 * This is a boundary check — not full Zod validation.
 *
 * Updated (07-v1-plan-wizard): validates limitations as PlanLimitation[] (object array)
 * and preferenceScores as {strength, hypertrophy, endurance, mobility: number}.
 *
 * Atomic coupling note: change 08 (ai-plan-generation) reads PlanSpec.limitations as
 * PlanLimitation[] — this boundary validates the same shape for both 07 (wizard confirm)
 * and 08 (consumption). Both changes share this boundary file.
 */
export function assertPlanSpecShape(input: unknown): asserts input is PlanSpec {
  if (typeof input !== "object" || input === null) {
    throw new Error("PlanSpec must be an object");
  }

  const obj = input as Record<string, unknown>;

  // Validate the wizard input fields first (goal, daysPerWeek, etc.)
  assertInputFields(obj);

  // Validate preferenceScores shape — required on the full PlanSpec
  if (typeof obj.preferenceScores !== "object" || obj.preferenceScores === null) {
    throw new Error("PlanSpec.preferenceScores must be an object");
  }

  const scores = obj.preferenceScores as Record<string, unknown>;

  const scoreKeys = ["strength", "hypertrophy", "endurance", "mobility"] as const;

  for (const key of scoreKeys) {
    if (typeof scores[key] !== "number") {
      throw new Error(`PlanSpec.preferenceScores.${key} must be a number`);
    }
    if ((scores[key] as number) < 0 || (scores[key] as number) > 1) {
      throw new Error(
        `PlanSpec.preferenceScores.${key} must be in [0, 1], got ${scores[key]}`
      );
    }
  }

  if (typeof obj.confirmed !== "boolean") {
    throw new Error("PlanSpec.confirmed must be a boolean");
  }

  // Optional plan name (#93) is validated by assertInputFields (called above)
  // via assertPlanName: string|null type + VARCHAR(120) length bound. A blank
  // wizard submission is normalized to null on promote so the read-side default
  // stays dynamic; absent is valid (legacy specs).
}
