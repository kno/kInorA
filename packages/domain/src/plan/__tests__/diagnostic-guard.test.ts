import { describe, it, expect } from "vitest";
import { assertNoDiagnosticLanguage } from "../diagnostic-guard.js";
import type { WorkoutProgram } from "@kinora/contracts";

function makeProgram(overrides?: Partial<WorkoutProgram>): WorkoutProgram {
  return {
    weeklySessions: [],
    limitationWarnings: [],
    ...overrides,
  };
}

function makeCleanProgram(): WorkoutProgram {
  return makeProgram({
    weeklySessions: [
      {
        day: 1,
        title: "Full Body Strength",
        exercises: [
          {
            name: "bodyweight squat",
            sets: 3,
            reps: "15",
            restSeconds: 60,
            notes: "Keep chest up and knees tracking over toes.",
          },
        ],
      },
    ],
    limitationWarnings: [
      "Consult a professional before attempting exercises that stress this area.",
    ],
  });
}

// ---------------------------------------------------------------------------
// Happy path — clean programs pass without throwing
// ---------------------------------------------------------------------------

describe("assertNoDiagnosticLanguage — clean programs pass", () => {
  it("does not throw for a program with no diagnostic language", () => {
    const program = makeCleanProgram();
    expect(() => assertNoDiagnosticLanguage(program)).not.toThrow();
  });

  it("does not throw for an empty program", () => {
    const program = makeProgram();
    expect(() => assertNoDiagnosticLanguage(program)).not.toThrow();
  });

  it("does not throw when notes contain professional advisory language", () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Recovery Day",
          exercises: [
            {
              name: "light walk",
              sets: 1,
              reps: "20 min",
              restSeconds: 0,
              notes: "Consult a professional if discomfort persists.",
            },
          ],
        },
      ],
    });
    expect(() => assertNoDiagnosticLanguage(program)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Diagnostic language detection — must throw
// ---------------------------------------------------------------------------

describe("assertNoDiagnosticLanguage — rejects diagnostic patterns in exercise notes", () => {
  it('throws when exercise notes contain "you have" diagnostic pattern', () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Rehab",
          exercises: [
            {
              name: "band pull-apart",
              sets: 3,
              reps: "15",
              restSeconds: 45,
              notes: "Because you have rotator cuff tendinitis, avoid overhead pressing.",
            },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });

  it('throws when exercise notes contain "you are diagnosed" pattern', () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Day 1",
          exercises: [
            {
              name: "plank",
              sets: 3,
              reps: "30s",
              restSeconds: 60,
              notes: "You are diagnosed with lower back syndrome; avoid heavy loads.",
            },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });

  it('throws when session title contains "diagnosis" pattern', () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Arthritis rehabilitation session",
          exercises: [
            { name: "leg raise", sets: 2, reps: "10", restSeconds: 60 },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });

  it('throws when substitutionNote contains "condition" diagnostic language', () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Modified Day",
          exercises: [
            {
              name: "push-up",
              sets: 3,
              reps: "10",
              restSeconds: 60,
              substitutionNote: "Your chronic condition means you cannot do bench press.",
            },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });

  it('throws when limitationWarnings contains "you suffer from" pattern', () => {
    const program = makeProgram({
      limitationWarnings: [
        "You suffer from degenerative disc disease — avoid heavy compound lifts.",
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });
});

describe("assertNoDiagnosticLanguage — case-insensitive matching", () => {
  it("detects diagnostic patterns regardless of casing", () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Day 1",
          exercises: [
            {
              name: "deadlift",
              sets: 3,
              reps: "5",
              restSeconds: 180,
              notes: "YOU HAVE herniated disc — keep back neutral.",
            },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });
});

describe("assertNoDiagnosticLanguage — error message quality", () => {
  it("error message identifies which string triggered the violation", () => {
    const program = makeProgram({
      limitationWarnings: ["You have sciatica — avoid long hip flexor stretches."],
    });

    let thrownError: unknown;
    try {
      assertNoDiagnosticLanguage(program);
    } catch (e) {
      thrownError = e;
    }

    expect(thrownError).toBeInstanceOf(Error);
    const message = (thrownError as Error).message;
    expect(message.length).toBeGreaterThan(0);
    expect(message).toMatch(/diagnostic/i);
  });
});
