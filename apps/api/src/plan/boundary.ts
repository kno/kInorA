import type { PlanSpec } from "@kinora/contracts";

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
}
