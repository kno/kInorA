import { describe, it, expect } from "vitest";
import { normalizeReps, normalizeProgramReps } from "../reps-normalizer.js";
import type { WorkoutProgram } from "@kinora/contracts";

// ---------------------------------------------------------------------------
// normalizeReps — canonical forms pass through unchanged
// ---------------------------------------------------------------------------

describe("normalizeReps — already-valid canonical forms pass through", () => {
  it('returns "8-12" unchanged (range)', () => {
    expect(normalizeReps("8-12")).toBe("8-12");
  });

  it('returns "15" unchanged (count)', () => {
    expect(normalizeReps("15")).toBe("15");
  });

  it('returns "10" unchanged (count)', () => {
    expect(normalizeReps("10")).toBe("10");
  });

  it('returns "20 min" unchanged (time)', () => {
    expect(normalizeReps("20 min")).toBe("20 min");
  });

  it('returns "30s" unchanged (time, no space)', () => {
    expect(normalizeReps("30s")).toBe("30s");
  });

  it('returns "45 sec" unchanged (time, with space)', () => {
    expect(normalizeReps("45 sec")).toBe("45 sec");
  });

  it("trims surrounding whitespace on an otherwise valid value", () => {
    expect(normalizeReps("  8-12  ")).toBe("8-12");
  });
});

// ---------------------------------------------------------------------------
// normalizeReps — salvage corrupted values
// ---------------------------------------------------------------------------

describe("normalizeReps — salvages corrupted values", () => {
  it('salvages "6- vain? 8" into "6-8"', () => {
    expect(normalizeReps("6- vain? 8")).toBe("6-8");
  });

  it('salvages "5-7lng" into "5-7"', () => {
    expect(normalizeReps("5-7lng")).toBe("5-7");
  });

  it('salvages "10 reps" into "10" (single integer)', () => {
    expect(normalizeReps("10 reps")).toBe("10");
  });

  it('defaults "vain?" to "8-12" (no digits)', () => {
    expect(normalizeReps("vain?")).toBe("8-12");
  });

  it('defaults "" to "8-12" (empty string)', () => {
    expect(normalizeReps("")).toBe("8-12");
  });
});

// ---------------------------------------------------------------------------
// normalizeReps — non-string / nullish coercion
// ---------------------------------------------------------------------------

describe("normalizeReps — coerces non-string/nullish input to default", () => {
  it("defaults null to '8-12'", () => {
    expect(normalizeReps(null as unknown as string)).toBe("8-12");
  });

  it("defaults undefined to '8-12'", () => {
    expect(normalizeReps(undefined as unknown as string)).toBe("8-12");
  });
});

// ---------------------------------------------------------------------------
// normalizeProgramReps — normalizes every exercise across all days, immutably
// ---------------------------------------------------------------------------

function makeProgram(): WorkoutProgram {
  return {
    weeklySessions: [
      {
        day: 1,
        title: "Day 1",
        exercises: [
          { name: "Squat", sets: 4, reps: "6- vain? 8", restSeconds: 90 },
          { name: "Bench", sets: 3, reps: "8-12", restSeconds: 60 },
        ],
      },
      {
        day: 2,
        title: "Day 2",
        exercises: [{ name: "Plank", sets: 3, reps: "30s", restSeconds: 30 }],
      },
    ],
    limitationWarnings: [],
  };
}

describe("normalizeProgramReps", () => {
  it("normalizes corrupted reps and leaves valid reps unchanged, across all days/exercises", () => {
    const program = makeProgram();
    const result = normalizeProgramReps(program);

    expect(result.weeklySessions[0]?.exercises[0]?.reps).toBe("6-8");
    expect(result.weeklySessions[0]?.exercises[1]?.reps).toBe("8-12");
    expect(result.weeklySessions[1]?.exercises[0]?.reps).toBe("30s");
  });

  it("does not mutate the input program", () => {
    const program = makeProgram();
    const original = JSON.parse(JSON.stringify(program)) as WorkoutProgram;

    normalizeProgramReps(program);

    expect(program).toEqual(original);
    expect(program.weeklySessions[0]?.exercises[0]?.reps).toBe("6- vain? 8");
  });
});
