import type { PlanSpec } from "@kinora/contracts";

/**
 * Validates that an unknown input has the structural shape of a PlanSpec.
 * Throws if required fields are missing or have wrong types.
 * This is a boundary check — not full Zod validation.
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

  if (typeof obj.confirmed !== "boolean") {
    throw new Error("PlanSpec.confirmed must be a boolean");
  }
}