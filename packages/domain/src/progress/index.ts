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
export { computeWeeklyRollup } from "./weekly-rollup.js";
export type { WeeklyRollupPlanDay, WeeklyRollupSession, WeeklyRollupRow } from "./weekly-rollup.js";
export { delta } from "./delta.js";
