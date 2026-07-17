/**
 * Shared title-normalization helper (09c-v1-progress-dashboard-stats, Slice 1a).
 *
 * Used by `classifyExerciseMuscleGroup` (keyword matching) and, in a later
 * slice, by personal-record grouping - both key an exercise off the same
 * normalized title so matching is case-, spacing-, and accent-insensitive
 * across EN/ES input.
 *
 * Normalization: trim, lowercase, strip diacritics/accents (Unicode NFD ->
 * drop combining marks), replace hyphens with spaces (so "Push-up",
 * "Push up", and "Pushup" all become comparable \u2014 see below), and collapse
 * internal whitespace to single spaces.
 *
 * Hyphen handling matters for the classifier's word-boundary keyword
 * matching (see classify.ts): normalizing hyphens to spaces means keywords
 * never need a hyphenated variant, only a space-separated one \u2014 "push up"
 * matches "Push-up", "Push up", and "Push  -  up" alike once normalized.
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
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
}
