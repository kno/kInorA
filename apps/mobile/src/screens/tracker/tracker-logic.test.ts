import { describe, it, expect } from "vitest";
import type {
  SessionExerciseRecord,
  SetRecordDTO,
  WorkoutSessionRecord,
} from "@kinora/contracts";
import {
  deriveTrackerView,
  elapsedSecondsSince,
  formatCountdown,
  formatElapsed,
  formatWeight,
  parseTargetReps,
  ringDashoffset,
  seedFromSet,
  segmentStates,
  stepReps,
  stepWeight,
} from "./tracker-logic";

function set(overrides: Partial<SetRecordDTO> & { id: string }): SetRecordDTO {
  return {
    sessionExerciseId: "ex",
    setIndex: 0,
    targetReps: "8",
    completed: false,
    ...overrides,
  };
}

function exercise(
  overrides: Partial<SessionExerciseRecord> & { id: string },
): SessionExerciseRecord {
  return {
    workoutSessionId: "s1",
    exerciseIndex: 0,
    title: "Ejercicio",
    restSeconds: 90,
    setRecords: [],
    ...overrides,
  };
}

function session(
  exercises: SessionExerciseRecord[],
  overrides: Partial<WorkoutSessionRecord> = {},
): WorkoutSessionRecord {
  return {
    id: "s1",
    workoutPlanId: "p1",
    status: "active",
    startedAt: "2026-07-08T10:00:00.000Z",
    exercises,
    ...overrides,
  };
}

describe("formatElapsed", () => {
  it("zero-pads minutes and seconds", () => {
    expect(formatElapsed(23 * 60 + 47)).toBe("23:47");
    expect(formatElapsed(9)).toBe("00:09");
    expect(formatElapsed(0)).toBe("00:00");
  });
  it("clamps negatives", () => {
    expect(formatElapsed(-5)).toBe("00:00");
  });
});

describe("formatCountdown", () => {
  it("does not pad minutes", () => {
    expect(formatCountdown(90)).toBe("1:30");
    expect(formatCountdown(5)).toBe("0:05");
  });
});

describe("elapsedSecondsSince", () => {
  it("computes whole seconds since start", () => {
    const start = "2026-07-08T10:00:00.000Z";
    const now = Date.parse(start) + 65_000;
    expect(elapsedSecondsSince(start, now)).toBe(65);
  });
  it("never returns negative", () => {
    const start = "2026-07-08T10:00:00.000Z";
    expect(elapsedSecondsSince(start, Date.parse(start) - 1000)).toBe(0);
  });
  it("returns 0 for an unparseable date", () => {
    expect(elapsedSecondsSince("not-a-date", Date.now())).toBe(0);
  });
});

describe("steppers", () => {
  it("steps weight by 2.5 and clamps", () => {
    expect(stepWeight(45, 1)).toBe(47.5);
    expect(stepWeight(45, -1)).toBe(42.5);
    expect(stepWeight(0, -1)).toBe(0);
    expect(stepWeight(300, 1)).toBe(300);
  });
  it("steps reps by 1 and clamps to >= 1", () => {
    expect(stepReps(8, 1)).toBe(9);
    expect(stepReps(1, -1)).toBe(1);
    expect(stepReps(99, 1)).toBe(99);
  });
});

describe("formatWeight", () => {
  it("renders integers without decimals", () => {
    expect(formatWeight(45)).toBe("45");
    expect(formatWeight(42.5)).toBe("42.5");
  });
});

describe("parseTargetReps", () => {
  it("parses the first integer", () => {
    expect(parseTargetReps("8")).toBe(8);
    expect(parseTargetReps("8-10")).toBe(8);
    expect(parseTargetReps("AMRAP")).toBe(8);
    expect(parseTargetReps("AMRAP", 12)).toBe(12);
  });
});

describe("seedFromSet", () => {
  it("prefers recorded values, then target reps", () => {
    expect(seedFromSet(set({ id: "a", weightKg: 60, actualReps: 6 }))).toEqual({
      weightKg: 60,
      reps: 6,
    });
    expect(seedFromSet(set({ id: "b", targetReps: "10" }))).toEqual({
      weightKg: 20,
      reps: 10,
    });
  });
});

describe("deriveTrackerView", () => {
  it("finds the first pending set as current", () => {
    const s = session([
      exercise({
        id: "e1",
        exerciseIndex: 0,
        title: "Press",
        setRecords: [
          set({ id: "s1-1", setIndex: 0, completed: true }),
          set({ id: "s1-2", setIndex: 1, completed: true }),
          set({ id: "s1-3", setIndex: 2, completed: false }),
        ],
      }),
      exercise({
        id: "e2",
        exerciseIndex: 1,
        title: "Aperturas",
        setRecords: [set({ id: "s2-1", setIndex: 0 })],
      }),
    ]);
    const v = deriveTrackerView(s);
    expect(v.exerciseCount).toBe(2);
    expect(v.currentExercise?.id).toBe("e1");
    expect(v.currentSet?.id).toBe("s1-3");
    expect(v.currentSetNumber).toBe(3);
    expect(v.setsInCurrentExercise).toBe(3);
    expect(v.currentExerciseNumber).toBe(1);
    expect(v.nextExercise?.id).toBe("e2");
    expect(v.totalSets).toBe(4);
    expect(v.completedSets).toBe(2);
    expect(v.percent).toBe(50);
    expect(v.isComplete).toBe(false);
  });

  it("marks complete when every set is done", () => {
    const s = session([
      exercise({
        id: "e1",
        setRecords: [set({ id: "a", completed: true })],
      }),
    ]);
    const v = deriveTrackerView(s);
    expect(v.isComplete).toBe(true);
    expect(v.currentExercise).toBeUndefined();
    expect(v.percent).toBe(100);
  });

  it("respects completed status even with pending sets", () => {
    const s = session(
      [exercise({ id: "e1", setRecords: [set({ id: "a" })] })],
      { status: "completed" },
    );
    expect(deriveTrackerView(s).isComplete).toBe(true);
  });

  it("orders exercises and sets defensively", () => {
    const s = session([
      exercise({ id: "e2", exerciseIndex: 1, setRecords: [set({ id: "b" })] }),
      exercise({ id: "e1", exerciseIndex: 0, setRecords: [set({ id: "a" })] }),
    ]);
    const v = deriveTrackerView(s);
    expect(v.currentExercise?.id).toBe("e1");
    expect(v.nextExercise?.id).toBe("e2");
  });
});

describe("segmentStates", () => {
  it("classifies done / active / pending per exercise", () => {
    const s = session([
      exercise({
        id: "e1",
        exerciseIndex: 0,
        setRecords: [set({ id: "a", completed: true })],
      }),
      exercise({
        id: "e2",
        exerciseIndex: 1,
        setRecords: [set({ id: "b", completed: false })],
      }),
      exercise({
        id: "e3",
        exerciseIndex: 2,
        setRecords: [set({ id: "c", completed: false })],
      }),
    ]);
    expect(segmentStates(s)).toEqual(["done", "active", "pending"]);
  });
});

describe("ringDashoffset", () => {
  it("is 0 when full and full circumference when empty", () => {
    const c = 345.4;
    expect(ringDashoffset(90, 90, c)).toBe(0);
    expect(ringDashoffset(0, 90, c)).toBe(345.4);
    expect(ringDashoffset(45, 90, c)).toBeCloseTo(172.7, 1);
  });
  it("guards a zero duration", () => {
    expect(ringDashoffset(0, 0, 100)).toBe(0);
  });
});
