import type { PlanSpec } from "@kinora/contracts";

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

  if (!Array.isArray(obj.limitations)) {
    throw new Error("PlanSpec.limitations must be an array");
  }

  // Validate each limitation is a PlanLimitation object {text: string, isWarning: boolean}
  for (let i = 0; i < obj.limitations.length; i++) {
    const limitation = obj.limitations[i] as unknown;
    if (typeof limitation !== "object" || limitation === null) {
      throw new Error(
        `PlanSpec.limitations[${i}] must be an object with {text: string, isWarning: boolean}`
      );
    }
    const lim = limitation as Record<string, unknown>;
    if (typeof lim.text !== "string") {
      throw new Error(
        `PlanSpec.limitations[${i}].text must be a string`
      );
    }
    if (typeof lim.isWarning !== "boolean") {
      throw new Error(
        `PlanSpec.limitations[${i}].isWarning must be a boolean`
      );
    }
  }

  // Validate preferenceScores shape
  if (typeof obj.preferenceScores !== "object" || obj.preferenceScores === null) {
    throw new Error("PlanSpec.preferenceScores must be an object");
  }

  const scores = obj.preferenceScores as Record<string, unknown>;

  if (typeof scores.strength !== "number") {
    throw new Error("PlanSpec.preferenceScores.strength must be a number");
  }

  if (typeof scores.hypertrophy !== "number") {
    throw new Error("PlanSpec.preferenceScores.hypertrophy must be a number");
  }

  if (typeof scores.endurance !== "number") {
    throw new Error("PlanSpec.preferenceScores.endurance must be a number");
  }

  if (typeof scores.mobility !== "number") {
    throw new Error("PlanSpec.preferenceScores.mobility must be a number");
  }

  if (typeof obj.confirmed !== "boolean") {
    throw new Error("PlanSpec.confirmed must be a boolean");
  }
}
