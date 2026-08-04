/**
 * `@kinora/exercise-catalog` — record types for the static exercise library.
 *
 * The catalog is a TRIMMED projection of the upstream
 * `hasaneyldrm/exercises-dataset` records: only the fields kInorA actually
 * renders are kept, renamed to the repo's camelCase convention. The generated
 * data file is produced by `scripts/import-exercise-catalog.ts`.
 *
 * LICENSING — two different licenses apply to a single record:
 *   - the DATA is MIT © 2026 Hasan Emir Yıldırım;
 *   - the MEDIA referenced by `imagePath` / `gifPath` is © Gym visual
 *     (https://gymvisual.com/) and is NOT MIT.
 * `attribution` carries the media notice verbatim and MUST be preserved and
 * surfaced wherever the media is displayed.
 */

/** Upstream `body_part` enum, kept verbatim (lowercase, space-separated). */
export type BodyPart =
  | "back"
  | "cardio"
  | "chest"
  | "lower arms"
  | "lower legs"
  | "neck"
  | "shoulders"
  | "upper arms"
  | "upper legs"
  | "waist";

/** Every `BodyPart` value, in stable alphabetical order. */
export const BODY_PARTS = [
  "back",
  "cardio",
  "chest",
  "lower arms",
  "lower legs",
  "neck",
  "shoulders",
  "upper arms",
  "upper legs",
  "waist",
] as const satisfies readonly BodyPart[];

/**
 * Ordered how-to steps. Only the two locales kInorA ships (`en`, `es`) are
 * retained from the upstream ten-locale payload; both are always present and
 * always have the same number of steps.
 */
export interface ExerciseInstructionSteps {
  en: string[];
  es: string[];
}

/** A single trimmed catalog record. */
export interface ExerciseCatalogRecord {
  /** Zero-padded upstream id, e.g. `"0001"`. Unique across the catalog. */
  id: string;
  /** Lowercase exercise name, e.g. `"3/4 sit-up"`. */
  name: string;
  bodyPart: BodyPart;
  /** Free-form equipment label, e.g. `"body weight"`, `"barbell"`. */
  equipment: string;
  /** Primary worked muscle, e.g. `"abs"`. */
  target: string;
  /** Broader muscle grouping, e.g. `"hip flexors"`. */
  muscleGroup: string;
  secondaryMuscles: string[];
  instructionSteps: ExerciseInstructionSteps;
  /**
   * SELF-HOSTED thumbnail, app-absolute — e.g.
   * `"/exercises/images/0001-2gPfomN.jpg"`, served from `apps/web/public`.
   */
  imagePath: string;
  /**
   * CDN-served animation, an ABSOLUTE https URL — e.g.
   * `"https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@<sha>/videos/0001-2gPfomN.gif"`.
   *
   * The GIFs (~123 MB) are deliberately NOT self-hosted, to keep them out of the
   * Docker image; they are served by jsDelivr from the upstream repository at an
   * immutable, pinned commit SHA. Consumers must treat this as an opaque URL and
   * MUST NOT assume a leading `/` or prepend an origin. See
   * `scripts/import-exercise-catalog.ts` (`DATASET_PINNED_SHA`).
   */
  gifPath: string;
  /** Media copyright notice, preserved verbatim from the upstream dataset. */
  attribution: string;
}

/**
 * Filters accepted by `listExercises`. Every field is optional.
 *
 * `bodyPart`/`equipment`/`target` are list-valued: a record matches a group
 * when its value is a member of the supplied list (OR within the group).
 * Absent and empty are equivalent — both mean "unconstrained" — so callers
 * may omit a key or pass `[]` interchangeably.
 */
export interface ExerciseCatalogFilters {
  bodyPart?: readonly BodyPart[];
  /** Free-form equipment labels; a record matches ANY listed value. */
  equipment?: readonly string[];
  /** Free-form target muscles; a record matches ANY listed value. */
  target?: readonly string[];
  /** Case- and accent-insensitive substring match on `name`. */
  search?: string;
  /** Maximum number of items returned. Omitted means "no limit". */
  limit?: number;
  /** Number of matches skipped before the returned page. Defaults to 0. */
  offset?: number;
}

/**
 * Filter dimensions only — no pagination window. Used by
 * `tallyExerciseFacets`, whose contract is to scan the WHOLE matching set, so
 * this type makes it impossible to accidentally pass `limit`/`offset` in.
 */
export type ExerciseFacetFilters = Pick<
  ExerciseCatalogFilters,
  "bodyPart" | "equipment" | "target" | "search"
>;

/** A page of catalog records plus the pre-pagination match count. */
export interface ExerciseCatalogPage {
  items: ExerciseCatalogRecord[];
  /** Number of records matching the filters BEFORE `limit`/`offset`. */
  total: number;
}
