/**
 * Tests for read-time plan→catalog linking (#352 slice A).
 *
 * The slice adds a technique link to plans that predate slice B's persisted
 * `catalogId`, and the two ways it could go wrong are opposites: it could fail
 * to link what it should, or it could touch something it must not. The second
 * is the silent one — a rewritten `name` changes a prescription the user
 * already trained with, and an overwritten stored id moves a link that was
 * resolved with equipment context this function does not have — so both are
 * asserted on every path, hit and miss alike.
 *
 * Ids are the shipped dataset's real ones, never invented, so a dataset
 * re-import that moves them fails here instead of in production.
 */
import { describe, expect, it } from "vitest";
import type { WorkoutProgram } from "@kinora/contracts";

import { withCatalogLinks } from "../catalog-links.js";

const PUSH_UP_ID = "0662";
const DUMBBELL_BENCH_PRESS_ID = "0289";

function programOf(
  ...exercises: Array<{ name: string; catalogId?: string }>
): WorkoutProgram {
  return {
    weeklySessions: [
      {
        day: 1,
        title: "Full Body A",
        exercises: exercises.map(({ name, catalogId }) => ({
          name,
          sets: 3,
          reps: "8-12",
          restSeconds: 60,
          ...(catalogId === undefined ? {} : { catalogId }),
        })),
      },
    ],
    limitationWarnings: [],
  };
}

const firstExerciseOf = (program: WorkoutProgram) => program.weeklySessions[0]?.exercises[0];

describe("withCatalogLinks — resolving a pre-slice-B plan", () => {
  it("links an exercise whose stored name is a catalog name", () => {
    const linked = withCatalogLinks(programOf({ name: "Dumbbell Bench Press" }));

    expect(firstExerciseOf(linked)?.catalogId).toBe(DUMBBELL_BENCH_PRESS_ID);
  });

  it("links a title the resolver only reaches through normalization", () => {
    // "Push-Ups" is plural and hyphenated: it misses exact/loose and lands on
    // "push-up" through the lenient tier. Historical plans are full of these.
    const linked = withCatalogLinks(programOf({ name: "Push-Ups" }));

    expect(firstExerciseOf(linked)?.catalogId).toBe(PUSH_UP_ID);
  });

  it("leaves an unresolvable exercise with NO catalogId key at all", () => {
    const linked = withCatalogLinks(programOf({ name: "Totally Invented Movement" }));

    // Not `catalogId: undefined` — absent and unresolved must be the same
    // shape, so the client has exactly one "no link" case to handle.
    expect(firstExerciseOf(linked)).not.toHaveProperty("catalogId");
  });

  it("never rewrites the prescribed name, on a hit or a miss", () => {
    const linked = withCatalogLinks(
      programOf({ name: "Push-Ups" }, { name: "Totally Invented Movement" }),
    );

    expect(linked.weeklySessions[0]?.exercises.map((exercise) => exercise.name)).toEqual([
      "Push-Ups",
      "Totally Invented Movement",
    ]);
  });

  it("links each exercise independently across every session", () => {
    const program: WorkoutProgram = {
      weeklySessions: [
        programOf({ name: "Push-Ups" }, { name: "Totally Invented Movement" })
          .weeklySessions[0]!,
        { day: 2, title: "Full Body B", exercises: programOf({ name: "Dumbbell Bench Press" }).weeklySessions[0]!.exercises },
      ],
      limitationWarnings: [],
    };

    const linked = withCatalogLinks(program);

    expect(
      linked.weeklySessions.flatMap((session) =>
        session.exercises.map((exercise) => exercise.catalogId),
      ),
    ).toEqual([PUSH_UP_ID, undefined, DUMBBELL_BENCH_PRESS_ID]);
  });

  it("does not mutate the program it was given", () => {
    const program = programOf({ name: "Push-Ups" });

    withCatalogLinks(program);

    expect(firstExerciseOf(program)).not.toHaveProperty("catalogId");
  });
});

describe("withCatalogLinks — an already-linked plan", () => {
  it("keeps a stored catalogId instead of re-resolving the name", () => {
    // The stored id was resolved at generation time against the user's
    // EQUIPMENT vocabulary; this function has no such context, so it must
    // never second-guess it — even when the name would resolve elsewhere.
    const linked = withCatalogLinks(
      programOf({ name: "Push-Ups", catalogId: DUMBBELL_BENCH_PRESS_ID }),
    );

    expect(firstExerciseOf(linked)?.catalogId).toBe(DUMBBELL_BENCH_PRESS_ID);
  });
});

describe("withCatalogLinks — non-program input", () => {
  it("passes undefined through for a generating or failed plan", () => {
    expect(withCatalogLinks(undefined)).toBeUndefined();
  });

  it("passes a malformed stored program through untouched rather than throwing", () => {
    const malformed = { weeklySessions: "not-an-array" };

    expect(withCatalogLinks(malformed as unknown)).toBe(malformed);
  });
});
