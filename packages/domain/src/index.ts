/**
 * Domain package — inner use-case and entity layer.
 *
 * This package depends ONLY on @kinora/contracts.
 * No framework, database, or infrastructure imports allowed.
 */

export { createPlanDraft } from "./plan/plan-draft";
export type { PlanDraft } from "./plan/plan-draft";