/**
 * Shared title-normalization helper (09c-v1-progress-dashboard-stats, Slice 1a).
 *
 * Used by `classifyExerciseMuscleGroup` (keyword matching) and, in a later
 * slice, by personal-record grouping - both key an exercise off the same
 * normalized title so matching is case-, spacing-, and accent-insensitive
 * across EN/ES input.
 *
 * Normalization: trim, lowercase, collapse internal whitespace to single
 * spaces, and strip diacritics/accents (Unicode NFD -> drop combining marks).
 *
 * Documented limitation: this does NOT merge true synonyms or wording
 * variants (e.g. "Bench Press" vs "Barbell Bench Press" remain distinct) -
 * see design.md "Title normalization".
 *
 * Pure - no I/O.
 */
export function normalizeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}
