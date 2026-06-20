import type { PlanSpec } from "@kinora/contracts";

/**
 * Creates a plan payload from a PlanSpec.
 * Returns the spec unchanged — a boundary function that proves
 * web can consume the @kinora/contracts type.
 */
export function createPlanPayload(spec: PlanSpec): PlanSpec {
  return { ...spec };
}