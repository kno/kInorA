/**
 * Resolves a generated program's free-text exercise names to catalog ids
 * (#352 slice B), server-side, after the model has answered.
 *
 * ## Why the name is never rewritten
 *
 * `WorkoutExercise.name` is the snapshot of what the user was prescribed. The
 * catalog is upstream reference data that can be re-imported and corrected, so
 * rewriting the name to the catalog's spelling would let a dataset refresh
 * retroactively change a plan someone already trained with. `catalogId` is
 * added ALONGSIDE the name; the name is copied through untouched.
 *
 * ## Why a miss is accepted rather than retried
 *
 * The model can still name something outside the vocabulary. Rejecting the
 * program and regenerating would turn a nearly-good plan into a failed one and
 * spend another metered generation to do it, for the sake of one link. So a
 * miss is kept as free text with no `catalogId` — the read side already treats
 * an unresolved exercise as "no technique link" and degrades silently — and is
 * reported through the observability seam so unresolved rates are measurable
 * rather than invisible.
 */
import { resolveExerciseByName } from "@kinora/exercise-catalog";
import type { WorkoutExercise, WorkoutProgram } from "@kinora/contracts";

/** One exercise the catalog could not account for. Ids and the name only. */
export interface UnresolvedExercise {
  /** Day of the weekly session the exercise sits in (1-based, as generated). */
  day: number;
  /** Position within that session's exercise array (0-based). */
  index: number;
  /** The prescribed free-text name. Not user content — safe to log (#310). */
  name: string;
  /**
   * `out_of_vocabulary` when the name resolved to a real catalog record the
   * user's equipment does not permit — the model ignored the closed list.
   * `no_match` when it resolved to nothing at all. The two are different
   * failures: the first is a prompt-adherence problem, the second a naming one.
   */
  reason: "out_of_vocabulary" | "no_match";
}

export interface CatalogResolutionResult {
  /** A new program with `catalogId` set wherever resolution succeeded. */
  program: WorkoutProgram;
  /** How many exercises were linked to the catalog. */
  resolvedCount: number;
  /** Every exercise that was not, in generation order. */
  unresolved: UnresolvedExercise[];
}

/**
 * Links every exercise in `program` to the catalog, restricted to `allowedIds`.
 *
 * `allowedIds` must be the user's FULL equipment-derived vocabulary, not the
 * capped subset shown in the prompt: the cap is a token budget, so an exercise
 * dropped from the prompt is still one the user can perform, and refusing to
 * link it would punish them for our budget.
 *
 * Pure and total: it never mutates the input, never throws, and returns the
 * program unchanged where it cannot resolve.
 */
export function resolveProgramCatalogIds(
  program: WorkoutProgram,
  allowedIds: ReadonlySet<string>,
): CatalogResolutionResult {
  const unresolved: UnresolvedExercise[] = [];
  let resolvedCount = 0;

  const weeklySessions = program.weeklySessions.map((session) => ({
    ...session,
    exercises: session.exercises.map((exercise, index): WorkoutExercise => {
      const match = resolveExerciseByName(exercise.name);

      if (match && allowedIds.has(match.record.id)) {
        resolvedCount++;
        // Spread-then-add: `name` is carried through verbatim by construction,
        // so no future edit here can silently start rewriting the snapshot.
        return { ...exercise, catalogId: match.record.id };
      }

      unresolved.push({
        day: session.day,
        index,
        name: exercise.name,
        reason: match ? "out_of_vocabulary" : "no_match",
      });
      // Strip any inherited `catalogId` rather than leaving a stale link: on a
      // regenerate-from-existing path an unresolvable name must end up with no
      // id at all, not the previous one.
      const { catalogId: _dropped, ...withoutCatalogId } = exercise;
      return withoutCatalogId;
    }),
  }));

  return { program: { ...program, weeklySessions }, resolvedCount, unresolved };
}
