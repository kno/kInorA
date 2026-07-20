/**
 * Thin re-export boundary for the `@kinora/domain/progress` classifier
 * (09c-v1-progress-dashboard-stats, Slice 1b).
 *
 * `workout-session.ts` also imports the root `@kinora/domain` barrel (for
 * `computeAverageRpe` / `computeSessionVolume` / etc.), and the subpath
 * isolation guard (Slice 1a, `no-root-barrel-import.test.ts`) forbids any
 * single file from importing both the root barrel and the `./progress`
 * subpath. Routing the classifier import through this dedicated module keeps
 * `workout-session.ts` clean of the subpath specifier while still using the
 * same classifier instance everywhere.
 */
export { classifyExerciseMuscleGroup } from "@kinora/domain/progress";
