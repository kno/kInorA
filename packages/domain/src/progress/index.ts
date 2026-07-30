/**
 * Progress domain subpath barrel (09c-v1-progress-dashboard-stats).
 *
 * Pure, framework-free functions backing the dashboard, statistics, and
 * weekly-overview surfaces. Exported ONLY through the `@kinora/domain/progress`
 * subpath — NEVER through the root `@kinora/domain` barrel, which re-exports
 * `auth/password` (scrypt → `node:crypto`) and would break the Next.js web
 * build if pulled into a page. See design.md "Where the aggregation code
 * lives, and why the subpath matters".
 */

export { classifyExerciseMuscleGroup } from "./classify.js";
export { normalizeTitle } from "./normalize.js";
export { computeStreak } from "./streak.js";
export { computeAdherence } from "./adherence.js";
export type { ComputeAdherenceInput, AdherenceResult } from "./adherence.js";
export { computeAdherenceAdaptation } from "./adherence-adaptation.js";
export type {
  ComputeAdherenceAdaptationInput,
  AdherenceAdaptationResult,
  AdherenceSnapshot,
  SuggestedChange,
} from "./adherence-adaptation.js";
export { computeWeeklyRollup } from "./weekly-rollup.js";
export type { WeeklyRollupPlanDay, WeeklyRollupSession, WeeklyRollupRow } from "./weekly-rollup.js";
export { delta } from "./delta.js";
export { computeMuscleGroupDistribution } from "./distribution.js";
export type { MuscleGroupDistributionExercise, MuscleGroupDistributionRow } from "./distribution.js";
export { computePersonalRecords } from "./personal-records.js";
export type { PersonalRecordSetInput } from "./personal-records.js";
export { computeWeeklyPlanVsCompletion } from "./weekly-plan-vs-completion.js";
export type { WeeklyPlanVsCompletionInput } from "./weekly-plan-vs-completion.js";
export { utcWeekBounds, utcDayKey, startOfUtcDay, addUtcDays, utcWeekdayIndex } from "./utc-week.js";
export {
  computeRpeAdaptation,
  WINDOW_SESSIONS as RPE_WINDOW_SESSIONS,
  RPE_HIGH_THRESHOLD,
  RPE_LOW_THRESHOLD,
  MIN_SESSIONS_WITH_RPE,
  MIN_SETS_WITH_RPE,
} from "./rpe-adaptation.js";
export type {
  IntensityBias,
  RpeSessionInput,
  ComputeRpeAdaptationInput,
  RpeAdaptationResult,
  RpeSuggestedChange,
  RpeSnapshot,
} from "./rpe-adaptation.js";
