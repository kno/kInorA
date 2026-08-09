import { describe, expect, it } from "vitest";
import type { WorkoutProgram, WorkoutSession } from "@kinora/contracts";
import {
  EDITED_PROGRAM_DAY_BOUNDS,
  validateEditedProgram,
} from "../edited-program.js";

function session(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    day: 1,
    title: "Push",
    exercises: [{ name: "Bench Press", sets: 3, reps: "8-10", restSeconds: 90 }],
    ...overrides,
  };
}

function program(sessions: WorkoutSession[]): WorkoutProgram {
  return { weeklySessions: sessions, limitationWarnings: [] };
}

describe("validateEditedProgram (17d PR D)", () => {
  it("accepts a structurally valid program", () => {
    expect(
      validateEditedProgram(program([session({ day: 1 }), session({ day: 3 })])),
    ).toEqual([]);
  });

  it("accepts a program using every day of the week", () => {
    const week = [1, 2, 3, 4, 5, 6, 7].map((day) => session({ day }));
    expect(validateEditedProgram(program(week))).toEqual([]);
  });

  it("rejects a program with zero sessions", () => {
    expect(validateEditedProgram(program([]))).toEqual(["empty_program"]);
  });

  it("rejects two sessions claiming the same day", () => {
    expect(
      validateEditedProgram(program([session({ day: 2 }), session({ day: 2 })])),
    ).toEqual(["duplicate_day"]);
  });

  it("reports duplicate_day once even when three sessions share a day", () => {
    expect(
      validateEditedProgram(
        program([session({ day: 2 }), session({ day: 2 }), session({ day: 2 })]),
      ),
    ).toEqual(["duplicate_day"]);
  });

  it("rejects day 0 — below the start route's lower bound", () => {
    expect(validateEditedProgram(program([session({ day: 0 })]))).toEqual([
      "invalid_day",
    ]);
  });

  it("rejects day 8 — above the start route's upper bound", () => {
    expect(validateEditedProgram(program([session({ day: 8 })]))).toEqual([
      "invalid_day",
    ]);
  });

  it("rejects a non-integer day, which no start request could ever match", () => {
    expect(validateEditedProgram(program([session({ day: 1.5 })]))).toEqual([
      "invalid_day",
    ]);
  });

  it("accepts exactly the documented bounds and nothing outside them", () => {
    const { min, max } = EDITED_PROGRAM_DAY_BOUNDS;
    expect(validateEditedProgram(program([session({ day: min })]))).toEqual([]);
    expect(validateEditedProgram(program([session({ day: max })]))).toEqual([]);
    expect(validateEditedProgram(program([session({ day: min - 1 })]))).toEqual([
      "invalid_day",
    ]);
    expect(validateEditedProgram(program([session({ day: max + 1 })]))).toEqual([
      "invalid_day",
    ]);
  });

  it("rejects a day with no exercises", () => {
    expect(
      validateEditedProgram(program([session({ day: 1, exercises: [] })])),
    ).toEqual(["empty_session"]);
  });

  it("reports empty_session once for several empty days", () => {
    expect(
      validateEditedProgram(
        program([
          session({ day: 1, exercises: [] }),
          session({ day: 2, exercises: [] }),
        ]),
      ),
    ).toEqual(["empty_session"]);
  });

  it("reports every simultaneous issue, in document order", () => {
    // Session 1 is empty; session 2 is out of bounds; session 3 duplicates
    // session 2's day. Read top-down, that is the order a user sees them.
    const issues = validateEditedProgram(
      program([
        session({ day: 1, exercises: [] }),
        session({ day: 9 }),
        session({ day: 9 }),
      ]),
    );

    expect(issues).toEqual(["empty_session", "invalid_day", "duplicate_day"]);
  });

  it("orders an invalid day before an empty session when the same session has both", () => {
    expect(
      validateEditedProgram(program([session({ day: 0, exercises: [] })])),
    ).toEqual(["invalid_day", "empty_session"]);
  });

  it("short-circuits on an empty program rather than reporting unrelated issues", () => {
    // No sessions means there is nothing else to say — a caller must not have
    // to filter "empty_session" out of an empty-program result.
    expect(validateEditedProgram(program([]))).toEqual(["empty_program"]);
  });

  it("never mutates the program it was handed", () => {
    const input = program([session({ day: 1 })]);
    const snapshot = JSON.stringify(input);

    validateEditedProgram(input);

    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
