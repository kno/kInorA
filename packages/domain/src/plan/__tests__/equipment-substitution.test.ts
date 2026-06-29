import { describe, it, expect } from "vitest";
import { applyEquipmentSubstitutions } from "../equipment-substitution.js";
import type { WorkoutProgram } from "@kinora/contracts";

// Minimal builder for test programs
function makeProgram(overrides?: Partial<WorkoutProgram>): WorkoutProgram {
  return {
    weeklySessions: [],
    limitationWarnings: [],
    ...overrides,
  };
}

describe("applyEquipmentSubstitutions — no-op when equipment is available", () => {
  it("returns program unchanged when the user has the required equipment", () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Upper Body",
          exercises: [
            { name: "barbell bench press", sets: 4, reps: "8-10", restSeconds: 90 },
          ],
        },
      ],
    });

    const result = applyEquipmentSubstitutions(program, ["barbell"]);

    const session = result.weeklySessions[0];
    const exercise = session?.exercises[0];
    expect(exercise?.name).toBe("barbell bench press");
    expect(exercise?.substitutionNote).toBeUndefined();
  });

  it("returns a structurally equal program (no mutation) when no substitutions are needed", () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Legs",
          exercises: [
            { name: "bodyweight squat", sets: 3, reps: "15", restSeconds: 60 },
          ],
        },
      ],
    });

    const result = applyEquipmentSubstitutions(program, ["dumbbells", "barbell"]);

    expect(result).toEqual(program);
  });
});

describe("applyEquipmentSubstitutions — bodyweight substitution when equipment missing", () => {
  it("substitutes barbell bench press → push-up when user has no equipment", () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Upper",
          exercises: [
            { name: "barbell bench press", sets: 4, reps: "8-10", restSeconds: 90 },
          ],
        },
      ],
    });

    const result = applyEquipmentSubstitutions(program, []);

    const exercise = result.weeklySessions[0]?.exercises[0];
    expect(exercise?.name).toBe("push-up");
    expect(exercise?.substitutionNote).toBeDefined();
    expect(typeof exercise?.substitutionNote).toBe("string");
    expect((exercise?.substitutionNote ?? "").length).toBeGreaterThan(0);
  });

  it("substitutes dumbbell bicep curl → resistance band curl when user has no free weights", () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Arms",
          exercises: [
            { name: "dumbbell bicep curl", sets: 3, reps: "12", restSeconds: 60 },
          ],
        },
      ],
    });

    const result = applyEquipmentSubstitutions(program, []);

    const exercise = result.weeklySessions[0]?.exercises[0];
    expect(exercise?.name).toBe("resistance band curl");
    expect(exercise?.substitutionNote).toMatch(/substituted/i);
  });

  it("records a substitution note that references both original and substitute exercise names", () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Back",
          exercises: [
            { name: "barbell row", sets: 4, reps: "8", restSeconds: 90 },
          ],
        },
      ],
    });

    const result = applyEquipmentSubstitutions(program, []);

    const exercise = result.weeklySessions[0]?.exercises[0];
    expect(exercise?.substitutionNote).toContain("barbell row");
    expect(exercise?.substitutionNote).toContain(exercise?.name ?? "");
  });

  it("substitutes multiple exercises across multiple sessions", () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Push",
          exercises: [
            { name: "barbell bench press", sets: 4, reps: "8", restSeconds: 90 },
            { name: "dumbbell shoulder press", sets: 3, reps: "10", restSeconds: 75 },
          ],
        },
        {
          day: 3,
          title: "Pull",
          exercises: [
            { name: "barbell row", sets: 4, reps: "8", restSeconds: 90 },
          ],
        },
      ],
    });

    const result = applyEquipmentSubstitutions(program, []);

    const session0 = result.weeklySessions[0];
    const session1 = result.weeklySessions[1];

    // All original equipment-dependent exercises were replaced
    expect(session0?.exercises[0]?.name).not.toBe("barbell bench press");
    expect(session0?.exercises[1]?.name).not.toBe("dumbbell shoulder press");
    expect(session1?.exercises[0]?.name).not.toBe("barbell row");

    // Substitution notes set on replaced exercises
    expect(session0?.exercises[0]?.substitutionNote).toBeDefined();
    expect(session0?.exercises[1]?.substitutionNote).toBeDefined();
    expect(session1?.exercises[0]?.substitutionNote).toBeDefined();
  });
});

describe("applyEquipmentSubstitutions — pure function (no mutation)", () => {
  it("does not mutate the input program", () => {
    const exercise = { name: "barbell bench press", sets: 4, reps: "8", restSeconds: 90 };
    const program = makeProgram({
      weeklySessions: [{ day: 1, title: "Push", exercises: [exercise] }],
    });

    applyEquipmentSubstitutions(program, []);

    // Original object unchanged
    expect(exercise.name).toBe("barbell bench press");
    expect((exercise as { substitutionNote?: string }).substitutionNote).toBeUndefined();
  });
});

describe("applyEquipmentSubstitutions — edge cases", () => {
  it("returns program unchanged when weeklySessions is empty", () => {
    const program = makeProgram({ weeklySessions: [] });
    const result = applyEquipmentSubstitutions(program, []);
    expect(result.weeklySessions).toEqual([]);
  });

  it("preserves limitationWarnings and other top-level fields", () => {
    const program = makeProgram({
      limitationWarnings: ["Consult a professional"],
      weeklySessions: [
        {
          day: 1,
          title: "Full Body",
          exercises: [
            { name: "bodyweight squat", sets: 3, reps: "15", restSeconds: 60 },
          ],
        },
      ],
    });

    const result = applyEquipmentSubstitutions(program, []);

    expect(result.limitationWarnings).toEqual(["Consult a professional"]);
  });
});
