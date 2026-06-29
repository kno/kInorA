import { describe, it, expect } from "vitest";
import { injectLimitationWarnings } from "../limitation-warnings.js";
import type { WorkoutProgram, PlanLimitation } from "@kinora/contracts";

function makeProgram(overrides?: Partial<WorkoutProgram>): WorkoutProgram {
  return {
    weeklySessions: [],
    limitationWarnings: [],
    ...overrides,
  };
}

function makeLimitation(text: string, isWarning = true): PlanLimitation {
  return { text, isWarning };
}

describe("injectLimitationWarnings — appends warnings for limitations", () => {
  it("appends a warning message when a limitation is present", () => {
    const program = makeProgram();
    const limitations = [makeLimitation("lower back pain")];

    const result = injectLimitationWarnings(program, limitations);

    expect(result.limitationWarnings).toHaveLength(1);
    const [w0] = result.limitationWarnings;
    expect(w0).toContain("lower back pain");
  });

  it("appends 'Consult a professional' advisory in the warning text", () => {
    const program = makeProgram();
    const limitations = [makeLimitation("knee injury")];

    const result = injectLimitationWarnings(program, limitations);

    const [first] = result.limitationWarnings;
    expect(first).toMatch(/consult a professional/i);
  });

  it("appends one warning per limitation when multiple limitations are given", () => {
    const program = makeProgram();
    const limitations = [
      makeLimitation("lower back pain"),
      makeLimitation("shoulder impingement"),
    ];

    const result = injectLimitationWarnings(program, limitations);

    expect(result.limitationWarnings).toHaveLength(2);
    const [lbp, shoulder] = result.limitationWarnings;
    expect(lbp).toContain("lower back pain");
    expect(shoulder).toContain("shoulder impingement");
  });
});

describe("injectLimitationWarnings — no hard-block", () => {
  it("always returns a program (never throws) regardless of limitation content", () => {
    const program = makeProgram();
    const limitations = [makeLimitation("severe chronic condition")];

    // Must not throw
    expect(() => injectLimitationWarnings(program, limitations)).not.toThrow();
    const result = injectLimitationWarnings(program, limitations);
    expect(result.weeklySessions).toEqual(program.weeklySessions);
  });

  it("does not remove or modify weeklySessions — only adds warnings", () => {
    const program = makeProgram({
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
    const limitations = [makeLimitation("knee pain")];

    const result = injectLimitationWarnings(program, limitations);

    expect(result.weeklySessions).toHaveLength(1);
    const session = result.weeklySessions[0];
    expect(session?.exercises).toHaveLength(1);
    expect(session?.exercises[0]?.name).toBe("bodyweight squat");
  });
});

describe("injectLimitationWarnings — no duplicate warnings", () => {
  it("does not append a warning that already exists in limitationWarnings", () => {
    const existingWarning = "Limitation: lower back pain — Consult a professional before attempting exercises that stress this area.";
    const program = makeProgram({
      limitationWarnings: [existingWarning],
    });
    const limitations = [makeLimitation("lower back pain")];

    const result = injectLimitationWarnings(program, limitations);

    // Should still be exactly 1 (not duplicated)
    expect(result.limitationWarnings).toHaveLength(1);
    const [firstWarning] = result.limitationWarnings;
    expect(firstWarning).toBe(existingWarning);
  });

  it("only deduplicates exact existing warnings — adds new ones", () => {
    const existingWarning = "Limitation: lower back pain — Consult a professional before attempting exercises that stress this area.";
    const program = makeProgram({
      limitationWarnings: [existingWarning],
    });
    const limitations = [
      makeLimitation("lower back pain"),
      makeLimitation("shoulder pain"),
    ];

    const result = injectLimitationWarnings(program, limitations);

    expect(result.limitationWarnings).toHaveLength(2);
    const [w0, w1] = result.limitationWarnings;
    expect(w0).toBe(existingWarning);
    expect(w1).toContain("shoulder pain");
  });
});

describe("injectLimitationWarnings — no limitations", () => {
  it("returns the program unchanged when limitations array is empty", () => {
    const program = makeProgram({
      limitationWarnings: ["existing warning"],
    });

    const result = injectLimitationWarnings(program, []);

    expect(result).toEqual(program);
  });
});

describe("injectLimitationWarnings — pure function", () => {
  it("does not mutate the input program", () => {
    const program = makeProgram({ limitationWarnings: [] });
    const originalWarnings = program.limitationWarnings;
    const limitations = [makeLimitation("knee pain")];

    injectLimitationWarnings(program, limitations);

    expect(program.limitationWarnings).toBe(originalWarnings);
    expect(program.limitationWarnings).toHaveLength(0);
  });
});
