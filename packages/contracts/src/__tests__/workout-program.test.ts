import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  WorkoutExercise,
  WorkoutProgram,
  WorkoutPlanStatus,
  WorkoutSession,
} from "../index";
import { WorkoutProgramSchema } from "../index";

// ---------------------------------------------------------------------------
// Task 1.1.1 — Type assertions: WorkoutPlanStatus, WorkoutExercise,
//              WorkoutSession, WorkoutProgram
// Task 1.2.1 / 1.3.3 — Zod schema assertions: valid parse, invalid rejection
// ---------------------------------------------------------------------------

describe("WorkoutPlanStatus (08-v1-ai-plan-generation)", () => {
  it("is a union of exactly generating | ready | failed", () => {
    expectTypeOf<WorkoutPlanStatus>().toEqualTypeOf<
      "generating" | "ready" | "failed"
    >();
  });
});

describe("WorkoutExercise (08-v1-ai-plan-generation)", () => {
  it("has required fields: name, sets, reps, restSeconds", () => {
    expectTypeOf<WorkoutExercise>().toHaveProperty("name").toBeString();
    expectTypeOf<WorkoutExercise>().toHaveProperty("sets").toBeNumber();
    expectTypeOf<WorkoutExercise>().toHaveProperty("reps").toBeString();
    expectTypeOf<WorkoutExercise>().toHaveProperty("restSeconds").toBeNumber();
  });

  it("has one optional field: notes", () => {
    expectTypeOf<WorkoutExercise>()
      .toHaveProperty("notes")
      .toMatchTypeOf<string | undefined>();
  });

  it("has NO substitutionNote field (#357)", () => {
    // The field was removed because nothing wrote it: the LLM filled it with
    // coaching tips only because the structured-output schema exposed it as a
    // second undescribed string, and the one server-side writer
    // (applyEquipmentSubstitutions) was a measured no-op and is gone.
    expectTypeOf<WorkoutExercise>().not.toHaveProperty("substitutionNote");
  });

  it("full shape matches design contract exactly", () => {
    expectTypeOf<WorkoutExercise>().toEqualTypeOf<{
      name: string;
      sets: number;
      reps: string;
      restSeconds: number;
      notes?: string;
    }>();
  });
});

describe("WorkoutSession (08-v1-ai-plan-generation)", () => {
  it("full shape has day, title, and exercises array", () => {
    expectTypeOf<WorkoutSession>().toEqualTypeOf<{
      day: number;
      title: string;
      exercises: WorkoutExercise[];
    }>();
  });
});

describe("WorkoutProgram (08-v1-ai-plan-generation)", () => {
  it("full shape has weeklySessions and limitationWarnings", () => {
    expectTypeOf<WorkoutProgram>().toEqualTypeOf<{
      weeklySessions: WorkoutSession[];
      limitationWarnings: string[];
    }>();
  });
});

// ---------------------------------------------------------------------------
// Zod schema: WorkoutProgramSchema
// ---------------------------------------------------------------------------

const validProgram = {
  weeklySessions: [
    {
      day: 1,
      title: "Upper Body",
      exercises: [
        {
          name: "Bench Press",
          sets: 4,
          reps: "8-12",
          restSeconds: 90,
          notes: "Focus on chest contraction",
        },
        {
          name: "Pull-up",
          sets: 3,
          reps: "6-10",
          restSeconds: 60,
          notes: "Use lat pulldown if no bar available",
        },
      ],
    },
    {
      day: 2,
      title: "Lower Body",
      exercises: [
        {
          name: "Squat",
          sets: 4,
          reps: "8-10",
          restSeconds: 120,
        },
      ],
    },
  ],
  limitationWarnings: [
    "Consult a professional before attempting high-impact movements.",
  ],
};

describe("WorkoutProgramSchema (08-v1-ai-plan-generation)", () => {
  it("parses a well-formed WorkoutProgram without errors", () => {
    const result = WorkoutProgramSchema.safeParse(validProgram);
    expect(result.success).toBe(true);
  });

  it("parsed output preserves all fields including optional ones", () => {
    const result = WorkoutProgramSchema.safeParse(validProgram);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const program = result.data;
    expect(program.weeklySessions).toHaveLength(2);

    const [upperBody, lowerBody] = program.weeklySessions;
    expect(upperBody).toBeDefined();
    expect(lowerBody).toBeDefined();
    if (!upperBody) return;

    expect(upperBody.title).toBe("Upper Body");

    const [benchPress, pullUp] = upperBody.exercises;
    expect(benchPress).toBeDefined();
    expect(pullUp).toBeDefined();
    if (!benchPress || !pullUp) return;

    expect(benchPress.name).toBe("Bench Press");
    expect(benchPress.notes).toBe("Focus on chest contraction");
    expect(pullUp.notes).toBe("Use lat pulldown if no bar available");

    expect(program.limitationWarnings).toHaveLength(1);
  });

  it("rejects a WorkoutProgram with a missing required field (name)", () => {
    const malformed = {
      ...validProgram,
      weeklySessions: [
        {
          day: 1,
          title: "Upper Body",
          exercises: [
            {
              // name is deliberately omitted
              sets: 3,
              reps: "10",
              restSeconds: 60,
            },
          ],
        },
      ],
    };
    const result = WorkoutProgramSchema.safeParse(malformed);
    expect(result.success).toBe(false);
  });

  it("rejects a WorkoutProgram missing weeklySessions entirely", () => {
    const result = WorkoutProgramSchema.safeParse({
      limitationWarnings: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a WorkoutProgram where sets is a string instead of number", () => {
    const malformed = {
      weeklySessions: [
        {
          day: 1,
          title: "Day 1",
          exercises: [
            {
              name: "Deadlift",
              sets: "four", // wrong type
              reps: "5",
              restSeconds: 180,
            },
          ],
        },
      ],
      limitationWarnings: [],
    };
    const result = WorkoutProgramSchema.safeParse(malformed);
    expect(result.success).toBe(false);
  });

  it("allows the optional notes field to be absent", () => {
    const minimal = {
      weeklySessions: [
        {
          day: 1,
          title: "Day 1",
          exercises: [
            {
              name: "Push-up",
              sets: 3,
              reps: "15",
              restSeconds: 45,
              // no notes
            },
          ],
        },
      ],
      limitationWarnings: [],
    };
    const result = WorkoutProgramSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });
});
