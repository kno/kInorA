/**
 * Read-time exercise-catalog linking for a stored `WorkoutProgram`
 * (#352 slice A).
 *
 * ## Why read time and not a migration
 *
 * Slice B made generation copy exercise names VERBATIM from the catalog and
 * persist the resolved `catalogId` into `program_json`, so every plan generated
 * from then on already carries its links. Everything generated BEFORE it does
 * not, and there are only two ways to give those plans a technique link:
 * backfill `program_json`, or resolve on read. Backfilling would rewrite stored
 * prescriptions with a guess made by whatever matcher was deployed the day the
 * migration ran, permanently — including the wrong guesses. Resolving here
 * costs three map lookups per exercise on a page that already does I/O, touches
 * no stored bytes, and means a better catalog or a corrected resolver silently
 * improves every historical plan on the next request.
 *
 * ## Why a stored `catalogId` is never re-resolved
 *
 * A stored id was resolved server-side at generation time AGAINST THE USER'S
 * EQUIPMENT VOCABULARY (see `ai/catalog-resolution.ts`). Name resolution here
 * has no such context, so re-deriving it could only ever replace a
 * better-informed answer with a worse one — and would silently move a link the
 * user may already have followed. The stored id therefore wins unconditionally,
 * and resolution is a FALLBACK for its absence, not a second opinion.
 */
import { resolveExerciseIdByName } from "@kinora/exercise-catalog";
import type { WorkoutExercise, WorkoutProgram } from "@kinora/contracts";

/**
 * Returns `program` with a `catalogId` on every exercise whose free-text `name`
 * resolves to a catalog record and that does not already carry one.
 *
 * Pure and total: never mutates the input, never throws, and returns the
 * exercise untouched — WITHOUT a `catalogId` key — when nothing resolves, so
 * the client sees the same "no link" shape slice B already produces for an
 * out-of-vocabulary name. `name` is copied through verbatim by construction:
 * the snapshot of what was prescribed is never rewritten to the catalog's
 * spelling.
 *
 * The `unknown` overload exists because the plan routes hold `programJson` as
 * `unknown` (the route layer must not import the DB layer, so it declares the
 * record shape structurally). Anything that is not a program with a
 * `weeklySessions` array — `undefined` for a generating/failed plan, or a
 * malformed legacy row — is returned as-is rather than coerced or rejected: a
 * missing technique link must never be able to break a plan read.
 */
export function withCatalogLinks(program: WorkoutProgram): WorkoutProgram;
export function withCatalogLinks(program: WorkoutProgram | undefined): WorkoutProgram | undefined;
export function withCatalogLinks(program: unknown): unknown;
export function withCatalogLinks(program: unknown): unknown {
  if (
    typeof program !== "object" ||
    program === null ||
    !Array.isArray((program as WorkoutProgram).weeklySessions)
  ) {
    return program;
  }

  const typed = program as WorkoutProgram;
  const weeklySessions = typed.weeklySessions.map((session) => ({
    ...session,
    exercises: (session.exercises ?? []).map((exercise): WorkoutExercise => {
      if (exercise.catalogId !== undefined) {
        return exercise;
      }

      const catalogId = resolveExerciseIdByName(exercise.name);
      // Spread-then-add so `name` cannot be rewritten by a future edit here,
      // and omit the key entirely on a miss rather than emitting
      // `catalogId: undefined` — absent and unresolved must look identical.
      return catalogId === undefined ? exercise : { ...exercise, catalogId };
    }),
  }));

  return { ...typed, weeklySessions };
}
