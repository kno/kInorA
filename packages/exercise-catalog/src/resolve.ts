/**
 * Name-based resolution from a free-text exercise title to a catalog record.
 *
 * Plans and tracker rows store the exercise as free text (`WorkoutExercise.name`,
 * `session_exercises.title`) — a snapshot of what the user was prescribed. This
 * module maps such a title back to a catalog record so the reader can be offered
 * the technique animation and instructions, WITHOUT rewriting that snapshot.
 *
 * ## Why this is deliberately conservative
 *
 * Measured against every distinct exercise title in production, exact-name
 * matching resolves a minority of titles: the generator's vocabulary
 * ("Resistance Band Rows", "Dumbbell Chest Press", "Walking Lunges") simply is
 * not the catalog's. The obvious next step — fuzzy/token-overlap matching —
 * was implemented and rejected on evidence, because it produces confidently
 * wrong answers:
 *
 *   "Band-Resisted Push-Ups"          -> "push-up (bosu ball)"
 *   "Standard Push-Ups"               -> "push-up (bosu ball)"
 *   "Bulgarian Split Squat"           -> "split squats"
 *   "Pull-Ups or Australian Pull-Ups" -> "pull up (neutral grip)"
 *
 * A wrong animation in the "how do I do this?" moment is worse than no
 * animation: it teaches the wrong movement and contradicts the equipment the
 * user said they own. So resolution here only ever returns a record it can
 * justify by NAME EQUALITY under progressively looser text normalization, and
 * returns `undefined` rather than guessing. Raising coverage is a generation-side
 * problem (constrain the model to this vocabulary), not a matching problem.
 *
 * ## The three tiers
 *
 * Each tier is exact equality on a derived key, never a substring or a score:
 *
 *  1. `exact`  — diacritic-stripped, lowercased, trimmed.
 *  2. `loose`  — additionally collapses every non-alphanumeric run to one
 *                space. This is what tolerates the four upstream records whose
 *                names carry mojibake (`sled 45в° calf press`, ids 0738/0739/
 *                0740/1464) against a cleanly written `sled 45° calf press`,
 *                and matches "Push Up" to "push-up". Note the dataset is
 *                internally inconsistent here — ids 0002 and 1463 carry a REAL
 *                `°` — so this cannot be a targeted fix for four ids.
 *  3. `lenient` — additionally drops parenthetical qualifiers and singularizes
 *                each token, so "Push-Ups", "Squats" and
 *                "Pull-ups (Assisted if needed)" reach "push-up", "squat" and
 *                "pull-up".
 */
import rawCatalog from "../data/exercises.catalog.json" with { type: "json" };

import type { ExerciseCatalogRecord } from "./types.js";

const records = rawCatalog as ExerciseCatalogRecord[];

/** How a title was matched, most precise first. Exposed for observability. */
export type ExerciseMatchTier = "exact" | "loose" | "lenient";

/** A resolved record plus which tier justified it. */
export interface ExerciseNameMatch {
  record: ExerciseCatalogRecord;
  tier: ExerciseMatchTier;
}

/**
 * Lowercase + strip diacritics. Mirrors `catalog.ts`'s `normalizeSearchText`
 * (kept separate so a change to search behaviour cannot silently re-point
 * every stored plan at a different exercise).
 */
function exactKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** {@link exactKey} with every non-alphanumeric run collapsed to one space. */
function looseKey(value: string): string {
  return exactKey(value).replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Naive English singularization, applied per token. Deliberately crude: it only
 * has to reconcile "squats"/"squat" and "push-ups"/"push-up", and both sides of
 * every comparison are run through it, so an over-eager trim that maps a
 * catalog name and a title to the same wrong stem still matches them to each
 * other. `-ss` is preserved ("press" must not become "pres").
 */
function singularize(token: string): string {
  if (token.endsWith("ies") && token.length > 3) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("sses") || token.endsWith("ches") || token.endsWith("shes")) {
    return token.slice(0, -2);
  }
  if (token.endsWith("ss")) {
    return token;
  }
  if (token.endsWith("es") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 2) {
    return token.slice(0, -1);
  }
  return token;
}

/** {@link looseKey} with each token singularized. */
function singularKey(value: string): string {
  return looseKey(value)
    .split(" ")
    .filter((token) => token !== "")
    .map(singularize)
    .join(" ");
}

/**
 * The `lenient` tier is DELIBERATELY ASYMMETRIC, and this is the subtlest part
 * of the module.
 *
 * A parenthetical in a CATALOG name is part of the exercise's identity:
 * "push-up (bosu ball)" and "push-up (wall)" are different movements needing
 * different equipment. A parenthetical in a PRESCRIBED title is annotation:
 * "Pull-ups (Negative Focus)", "(each side)", "(Assisted if needed)".
 *
 * Stripping parentheses from both sides — the first implementation here —
 * collapsed "push-up (bosu ball)" and "push-up" onto the same key, and the
 * lower upstream id won, so "Push-Ups" resolved to the BOSU BALL variant. That
 * is precisely the confidently-wrong answer this module exists to prevent, so
 * parentheses are stripped from the QUERY only.
 */
function lenientQueryKey(value: string): string {
  return singularKey(value.replace(/\([^)]*\)/g, " "));
}

/**
 * Builds one key -> record index.
 *
 * `onAmbiguity` decides what a colliding key means:
 *
 *  - `"first-wins"` for the `exact` tier. The dataset contains genuine
 *    duplicate names ("lever chest press" is both 0576 and 0577; "barbell
 *    seated calf raise" is 0088 and 1371). Those are near-identical records, so
 *    the lower upstream id is a safe, deterministic tie-break — it cannot land
 *    on a different movement.
 *  - `"reject"` for the lossy tiers. There, a collision means normalization
 *    threw away something that distinguished two records, so any pick would be
 *    a guess. Resolving to nothing is correct: no link beats a wrong link.
 */
function indexBy(
  key: (name: string) => string,
  onAmbiguity: "first-wins" | "reject",
): ReadonlyMap<string, ExerciseCatalogRecord> {
  const index = new Map<string, ExerciseCatalogRecord>();
  const ambiguous = new Set<string>();

  for (const record of records) {
    const derived = key(record.name);
    if (derived === "") {
      continue;
    }
    const existing = index.get(derived);
    if (existing === undefined) {
      index.set(derived, record);
    } else if (existing.id !== record.id && onAmbiguity === "reject") {
      ambiguous.add(derived);
    }
  }

  for (const derived of ambiguous) {
    index.delete(derived);
  }
  return index;
}

const byExact = indexBy(exactKey, "first-wins");
const byLoose = indexBy(looseKey, "reject");
const byLenient = indexBy(singularKey, "reject");

const TIERS: ReadonlyArray<{
  tier: ExerciseMatchTier;
  /** Applied to the caller's title. May differ from the catalog-side key. */
  key: (name: string) => string;
  index: ReadonlyMap<string, ExerciseCatalogRecord>;
}> = [
  { tier: "exact", key: exactKey, index: byExact },
  { tier: "loose", key: looseKey, index: byLoose },
  { tier: "lenient", key: lenientQueryKey, index: byLenient },
];

/**
 * Resolves a free-text exercise title to a catalog record, or `undefined` when
 * no tier matches by name equality.
 *
 * Never throws and never guesses: an unknown, blank or invented title is
 * `undefined`, which callers MUST degrade silently on (no link, no error card).
 * The returned `tier` says how much normalization was needed, so coverage and
 * match quality can be measured in production instead of estimated.
 */
export function resolveExerciseByName(title: string): ExerciseNameMatch | undefined {
  if (typeof title !== "string" || title.trim() === "") {
    return undefined;
  }

  for (const { tier, key, index } of TIERS) {
    const derived = key(title);
    if (derived === "") {
      continue;
    }
    const record = index.get(derived);
    if (record !== undefined) {
      return { record, tier };
    }
  }

  return undefined;
}

/**
 * Convenience wrapper for callers that only need the id to build a link.
 * Same conservative contract as {@link resolveExerciseByName}.
 */
export function resolveExerciseIdByName(title: string): string | undefined {
  return resolveExerciseByName(title)?.record.id;
}
