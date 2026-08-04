/**
 * `@kinora/exercise-catalog` — the static, read-only exercise library.
 *
 * Data: MIT © 2026 Hasan Emir Yıldırım (hasaneyldrm/exercises-dataset).
 * Media referenced by `imagePath` / `gifPath`: © Gym visual
 * (https://gymvisual.com/) — NOT MIT. Keep each record's `attribution`
 * visible wherever its media is rendered. Full terms:
 * `apps/web/public/exercises/ATTRIBUTION.md`.
 */
export { getExerciseById, listExercises } from "./catalog.js";

export { BODY_PARTS } from "./types.js";
export type {
  BodyPart,
  ExerciseCatalogFilters,
  ExerciseCatalogPage,
  ExerciseCatalogRecord,
  ExerciseInstructionSteps,
} from "./types.js";
