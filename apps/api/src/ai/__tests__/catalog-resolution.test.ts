/**
 * Tests for the post-generation catalog linking step (#352 slice B).
 *
 * Two properties carry the slice, and they pull in opposite directions:
 * a resolvable exercise MUST gain a `catalogId`, and NOTHING may ever gain a
 * rewritten `name`. The second is the one that would rot silently — a plan
 * whose prescriptions change under the user when the upstream dataset is
 * re-imported — so it is asserted on every path, hit and miss alike.
 */
import { describe, expect, it } from "vitest";
import type { WorkoutProgram } from "@kinora/contracts";

import { resolveProgramCatalogIds } from "../catalog-resolution.js";
import { resolveExerciseVocabulary } from "../exercise-vocabulary.js";

/** Real ids, asserted against the shipped dataset rather than invented. */
const PUSH_UP_ID = "0662";
const DUMBBELL_BENCH_PRESS_ID = "0289";

function allowedIdsFor(equipment: string[]): ReadonlySet<string> {
  return new Set(resolveExerciseVocabulary(equipment).exercises.map((record) => record.id));
}

function programOf(...names: string[]): WorkoutProgram {
  return {
    weeklySessions: [
      {
        day: 1,
        title: "Full Body A",
        exercises: names.map((name) => ({ name, sets: 3, reps: "8-12", restSeconds: 60 })),
      },
    ],
    limitationWarnings: [],
  };
}

describe("resolveProgramCatalogIds — inside the vocabulary", () => {
  it("attaches the catalog id of an exercise the user can perform", () => {
    const result = resolveProgramCatalogIds(programOf("push-up"), allowedIdsFor(["bodyweight"]));

    expect(result.program.weeklySessions[0]?.exercises[0]?.catalogId).toBe(PUSH_UP_ID);
    expect(result.resolvedCount).toBe(1);
    expect(result.unresolved).toEqual([]);
  });

  it("keeps the prescribed name verbatim instead of the catalog spelling", () => {
    // "Push-Ups" only reaches "push-up" through the lenient tier, so the
    // catalog's spelling differs from the prescription. The prescription wins:
    // it is what the user was shown.
    const result = resolveProgramCatalogIds(programOf("Push-Ups"), allowedIdsFor(["bodyweight"]));

    const exercise = result.program.weeklySessions[0]?.exercises[0];
    expect(exercise?.name).toBe("Push-Ups");
    expect(exercise?.catalogId).toBe(PUSH_UP_ID);
  });

  it("resolves against the full vocabulary, not just the equipment box ticked", () => {
    const result = resolveProgramCatalogIds(
      programOf("dumbbell bench press"),
      allowedIdsFor(["dumbbells", "bench"]),
    );

    expect(result.program.weeklySessions[0]?.exercises[0]?.catalogId).toBe(
      DUMBBELL_BENCH_PRESS_ID,
    );
  });

  it("does not mutate the input program", () => {
    const program = programOf("push-up");
    resolveProgramCatalogIds(program, allowedIdsFor(["bodyweight"]));

    expect(program.weeklySessions[0]?.exercises[0]).not.toHaveProperty("catalogId");
  });
});

describe("resolveProgramCatalogIds — outside the vocabulary", () => {
  it("keeps an invented exercise as free text with no catalogId", () => {
    const result = resolveProgramCatalogIds(
      programOf("Interstellar Thruster Complex"),
      allowedIdsFor(["bodyweight"]),
    );

    const exercise = result.program.weeklySessions[0]?.exercises[0];
    expect(exercise?.name).toBe("Interstellar Thruster Complex");
    expect(exercise).not.toHaveProperty("catalogId");
    expect(result.resolvedCount).toBe(0);
    expect(result.unresolved).toEqual([
      { day: 1, index: 0, name: "Interstellar Thruster Complex", reason: "no_match" },
    ]);
  });

  it("refuses a real catalog exercise the user's equipment does not allow", () => {
    // The distinct failure mode: the name IS in the catalog, but the model
    // ignored the closed list and prescribed something needing a dumbbell.
    const result = resolveProgramCatalogIds(
      programOf("dumbbell bench press"),
      allowedIdsFor(["bodyweight"]),
    );

    expect(result.program.weeklySessions[0]?.exercises[0]).not.toHaveProperty("catalogId");
    expect(result.unresolved[0]?.reason).toBe("out_of_vocabulary");
  });

  it("does not fail the plan — resolvable siblings are still linked", () => {
    const result = resolveProgramCatalogIds(
      programOf("push-up", "Interstellar Thruster Complex", "burpee"),
      allowedIdsFor(["bodyweight"]),
    );

    const exercises = result.program.weeklySessions[0]?.exercises ?? [];
    expect(exercises.map((e) => e.catalogId)).toEqual([PUSH_UP_ID, undefined, "1160"]);
    expect(result.resolvedCount).toBe(2);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]?.index).toBe(1);
  });

  it("drops a stale inherited catalogId rather than leaving a wrong link", () => {
    const program: WorkoutProgram = {
      weeklySessions: [
        {
          day: 1,
          title: "Full Body A",
          exercises: [
            {
              name: "Interstellar Thruster Complex",
              sets: 3,
              reps: "8-12",
              restSeconds: 60,
              catalogId: PUSH_UP_ID,
            },
          ],
        },
      ],
      limitationWarnings: [],
    };

    const result = resolveProgramCatalogIds(program, allowedIdsFor(["bodyweight"]));

    expect(result.program.weeklySessions[0]?.exercises[0]).not.toHaveProperty("catalogId");
  });

  it("reports the day of the session the miss came from", () => {
    const program: WorkoutProgram = {
      weeklySessions: [
        { day: 1, title: "A", exercises: [{ name: "push-up", sets: 3, reps: "8", restSeconds: 60 }] },
        { day: 4, title: "B", exercises: [{ name: "Nonsense Lift", sets: 3, reps: "8", restSeconds: 60 }] },
      ],
      limitationWarnings: [],
    };

    const result = resolveProgramCatalogIds(program, allowedIdsFor(["bodyweight"]));

    expect(result.unresolved).toEqual([
      { day: 4, index: 0, name: "Nonsense Lift", reason: "no_match" },
    ]);
  });
});

describe("resolveProgramCatalogIds — degenerate input", () => {
  it("handles an empty program", () => {
    const empty: WorkoutProgram = { weeklySessions: [], limitationWarnings: [] };
    const result = resolveProgramCatalogIds(empty, allowedIdsFor([]));

    expect(result).toEqual({ program: empty, resolvedCount: 0, unresolved: [] });
  });

  it("treats a blank name as an unresolvable miss, not a crash", () => {
    const result = resolveProgramCatalogIds(programOf("   "), allowedIdsFor([]));

    expect(result.unresolved[0]?.reason).toBe("no_match");
    expect(result.program.weeklySessions[0]?.exercises[0]?.name).toBe("   ");
  });

  it("preserves everything else on the exercise", () => {
    const program: WorkoutProgram = {
      weeklySessions: [
        {
          day: 1,
          title: "A",
          exercises: [
            { name: "push-up", sets: 5, reps: "10-15", restSeconds: 45, notes: "slow tempo" },
          ],
        },
      ],
      limitationWarnings: ["keep it gentle"],
    };

    const result = resolveProgramCatalogIds(program, allowedIdsFor(["bodyweight"]));

    expect(result.program.weeklySessions[0]?.exercises[0]).toEqual({
      name: "push-up",
      sets: 5,
      reps: "10-15",
      restSeconds: 45,
      notes: "slow tempo",
      catalogId: PUSH_UP_ID,
    });
    expect(result.program.limitationWarnings).toEqual(["keep it gentle"]);
  });
});
