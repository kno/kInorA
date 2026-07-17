/**
 * Thin re-export boundary for `@kinora/domain/progress` aggregation
 * functions (09c-v1-progress-dashboard-stats, Slice 2).
 *
 * `workout-session.ts` also imports the root `@kinora/domain` barrel (for
 * `computeAverageRpe` / `computeSessionVolume` / etc.), and the subpath
 * isolation guard (`no-root-barrel-import.test.ts`) forbids any single file
 * from importing both the root barrel and the `./progress` subpath. Routing
 * these imports through this dedicated module keeps `workout-session.ts`
 * clean of the subpath specifier — mirrors `muscle-classifier.ts` (Slice 1b).
 */
export { computeStreak, computeAdherence, computeWeeklyRollup, delta } from "@kinora/domain/progress";
