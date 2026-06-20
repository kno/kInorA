import type { PlanSpec } from "@kinora/contracts";

export interface PlanDraft extends PlanSpec {
  confirmed: false;
}

export function createPlanDraft(spec: PlanSpec): PlanDraft {
  return { ...spec, confirmed: false };
}