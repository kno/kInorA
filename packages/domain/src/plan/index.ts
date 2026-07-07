/**
 * Plan domain subpath barrel.
 *
 * Exposes ONLY the framework-free plan use-cases so consumers (e.g. the web
 * app mirroring `derivePreferenceScores` client-side) can import the plan
 * domain without pulling in the auth modules that depend on Node crypto.
 */

export { createPlanDraft } from "./plan-draft.js";
export type { PlanDraft } from "./plan-draft.js";

export { derivePreferenceScores } from "./derive-preference-scores.js";

export { defaultPlanName } from "./default-plan-name.js";

export {
  SESSION_DURATION_LIMITS,
  validateSessionDuration,
} from "./session-duration.js";
export type { SessionDurationValidation } from "./session-duration.js";

export { validateRpe } from "./rpe.js";
export type { RpeValidation } from "./rpe.js";

export { applyEquipmentSubstitutions } from "./equipment-substitution.js";
export { injectLimitationWarnings } from "./limitation-warnings.js";
export { assertNoDiagnosticLanguage } from "./diagnostic-guard.js";
