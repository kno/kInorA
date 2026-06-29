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
// (guard keys on diagnostic PHRASING/ATTRIBUTION, not bare condition nouns)
// ---------------------------------------------------------------------------

describe("assertNoDiagnosticLanguage — rejects diagnostic attribution phrases", () => {
  it('throws when exercise notes contain "you have" attribution', () => {
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
              notes: "Because you have rotator cuff pain, avoid overhead pressing.",
            },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });

  it('throws when exercise notes contain "you are diagnosed with" pattern', () => {
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
              notes: "You are diagnosed with lower back issues; avoid heavy loads.",
            },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });

  it('throws when exercise notes contain "diagnosed with" attribution (without "you are")', () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Day 1",
          exercises: [
            {
              name: "leg press",
              sets: 3,
              reps: "12",
              restSeconds: 90,
              notes: "Because you were diagnosed with hypertension, keep intensity moderate.",
            },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });

  it('throws when substitutionNote contains "your chronic condition" attribution', () => {
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

  it('throws when limitationWarnings contains "you suffer from" attribution', () => {
    const program = makeProgram({
      limitationWarnings: [
        "You suffer from disc issues — avoid heavy compound lifts.",
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });

  it('throws when notes contain "this indicates" diagnostic attribution', () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Strength Day",
          exercises: [
            {
              name: "deadlift",
              sets: 3,
              reps: "5",
              restSeconds: 180,
              notes: "This indicates a rotator cuff tear — avoid overhead pressing.",
            },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });

  it('throws when notes contain "you may have" hedged diagnosis', () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Day 1",
          exercises: [
            {
              name: "squat",
              sets: 3,
              reps: "10",
              restSeconds: 60,
              notes: "You may have a herniated disc — reduce load significantly.",
            },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });

  it('throws when notes contain "symptoms of" diagnostic attribution', () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Day 1",
          exercises: [
            {
              name: "shoulder press",
              sets: 3,
              reps: "10",
              restSeconds: 60,
              notes: "Avoid if showing symptoms of rotator cuff impingement.",
            },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });
});

describe("assertNoDiagnosticLanguage — case-insensitive matching", () => {
  it("detects diagnostic phrases regardless of casing", () => {
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
              notes: "YOU HAVE a back injury — keep neutral spine.",
            },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Legit fitness content — must NOT throw (false-positive guard)
// ---------------------------------------------------------------------------

describe("assertNoDiagnosticLanguage — passes legitimate fitness content without throwing", () => {
  it("does not throw for a session title mentioning a condition noun without attribution", () => {
    // "Arthritis rehab" as a session category is common programming vocabulary;
    // the guard must not block it because there is no attribution phrasing.
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Arthritis-friendly low-impact session",
          exercises: [
            { name: "leg raise", sets: 2, reps: "10", restSeconds: 60 },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).not.toThrow();
  });

  it('does not throw for "iliotibial band syndrome" mentioned as a context reference (not attribution)', () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Knee Mobility",
          exercises: [
            {
              name: "lateral band walk",
              sets: 3,
              reps: "15",
              restSeconds: 45,
              notes: "Modify if you experience iliotibial band syndrome discomfort.",
            },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).not.toThrow();
  });

  it('does not throw for "general metabolic health" — common fitness phrasing', () => {
    const program = makeProgram({
      weeklySessions: [
        {
          day: 1,
          title: "Cardio",
          exercises: [
            {
              name: "rowing machine",
              sets: 1,
              reps: "20 min",
              restSeconds: 0,
              notes: "Great for general metabolic health and cardiovascular conditioning.",
            },
          ],
        },
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).not.toThrow();
  });

  it("does not throw for professional advisory language in limitationWarnings", () => {
    const program = makeProgram({
      limitationWarnings: [
        "Limitation: lower back pain — Consult a professional before attempting exercises that stress this area.",
      ],
    });

    expect(() => assertNoDiagnosticLanguage(program)).not.toThrow();
  });
});

describe("assertNoDiagnosticLanguage — error message quality", () => {
  it("error message identifies which string triggered the violation", () => {
    const program = makeProgram({
      limitationWarnings: ["You have back pain — avoid long hip flexor stretches."],
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
