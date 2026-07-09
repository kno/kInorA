import { describe, it, expect } from "vitest";
import type {
  SessionExerciseRecord,
  SetRecordDTO,
  WorkoutSessionRecord,
} from "@kinora/contracts";
import {
  computeElapsedSeconds,
  computeRestRemaining,
  deriveTrackerView,
  elapsedSecondsSince,
  formatCountdown,
  formatElapsed,
  formatWeight,
  objectiveWeightFor,
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
  it("normalizes binary float artifacts via toFixed(1)", () => {
    // Repeated ±2.5 stepping must never accumulate float noise like
    // 12.500000000000002 — the Number(next.toFixed(1)) normalization keeps
    // every value clean to one decimal.
    let w = 0;
    for (let i = 0; i < 40; i += 1) w = stepWeight(w, 1);
    expect(w).toBe(100);
    // Each intermediate value stays a clean 0.1-grid number.
    let v = 5;
    for (let i = 0; i < 20; i += 1) {
      v = stepWeight(v, 1);
      expect(v).toBe(Number(v.toFixed(1)));
    }
  });
});

describe("computeElapsedSeconds", () => {
  const NO_PAUSE = { pausedAccumMs: 0, pauseStartMs: null };

  it("tracks WALL-CLOCK across a backgrounded jump without per-second ticks", () => {
    const start = 1_000_000;
    // App backgrounds at t=5s, resumes 5 minutes later with a SINGLE reconcile.
    // A tick-counting timer would report ~5s; wall-clock reports the full span.
    expect(computeElapsedSeconds(start, start + 5_000, NO_PAUSE)).toBe(5);
    const afterBackground = start + 5_000 + 300_000;
    expect(computeElapsedSeconds(start, afterBackground, NO_PAUSE)).toBe(305);
  });

  it("freezes while paused and resumes without losing the running total", () => {
    const start = 0;
    // Running for 10s, then pause begins at t=10s.
    const pausedState = { pausedAccumMs: 0, pauseStartMs: 10_000 };
    // 30s of wall-time pass while paused: display stays frozen at 10s.
    expect(computeElapsedSeconds(start, 40_000, pausedState)).toBe(10);
    // Resume at t=40s: the 30s pause is folded into the accumulator.
    const resumed = { pausedAccumMs: 30_000, pauseStartMs: null };
    // 5s more running → 15s total (paused span excluded).
    expect(computeElapsedSeconds(start, 45_000, resumed)).toBe(15);
  });

  it("is NaN-safe for an invalid start", () => {
    expect(computeElapsedSeconds(Number.NaN, 10_000, NO_PAUSE)).toBe(0);
  });
});

describe("computeRestRemaining", () => {
  const NO_PAUSE = { pausedAccumMs: 0, pauseStartMs: null };

  it("counts down against a wall-clock end target", () => {
    const endsAt = 90_000; // 90s rest, now=0
    expect(computeRestRemaining(endsAt, 0, NO_PAUSE)).toBe(90);
    expect(computeRestRemaining(endsAt, 45_000, NO_PAUSE)).toBe(45);
    // Backgrounded past the end → cleared.
    expect(computeRestRemaining(endsAt, 91_000, NO_PAUSE)).toBeNull();
    expect(computeRestRemaining(endsAt, 90_000, NO_PAUSE)).toBeNull();
  });

  it("freezes while paused and does not catch up on resume", () => {
    const endsAt = 90_000; // now=0
    // Pause begins at t=30s (60s remaining).
    const paused = { pausedAccumMs: 0, pauseStartMs: 30_000 };
    // 20s pass while paused: still 60s remaining (frozen, not catching up).
    expect(computeRestRemaining(endsAt, 50_000, paused)).toBe(60);
    // Resume at t=50s: pause span folded in; target effectively shifted +20s.
    const resumed = { pausedAccumMs: 20_000, pauseStartMs: null };
    expect(computeRestRemaining(endsAt, 50_000, resumed)).toBe(60);
    // 10s more running → 50s remaining.
    expect(computeRestRemaining(endsAt, 60_000, resumed)).toBe(50);
  });
});

describe("ringDashoffset overshoot", () => {
  it("clamps to a valid offset when remaining exceeds duration (+15s)", () => {
    const c = 345.4;
    // +15s can push remaining above the original duration; the arc must stay
    // full (offset 0), never negative or NaN.
    const offset = ringDashoffset(105, 90, c);
    expect(offset).toBe(0);
    expect(Number.isFinite(offset)).toBe(true);
    expect(offset).toBeGreaterThanOrEqual(0);
  });
});

describe("objectiveWeightFor", () => {
  it("returns the set's prescribed weight, ignoring live stepper state", () => {
    expect(objectiveWeightFor(set({ id: "a", weightKg: 60 }))).toBe(60);
  });
  it("returns undefined when the plan prescribes no weight", () => {
    expect(objectiveWeightFor(set({ id: "b" }))).toBeUndefined();
    expect(objectiveWeightFor(undefined)).toBeUndefined();
  });
});

// Progress a11y value coherence and objectiveLabelNoWeight's copy behavior
// (the regression this described — a mixed-unit numeric range reading as
// "9 of 3" — plus the bodyweight-only reps case) are now covered against
// the `@kinora/i18n` catalog keys in `copy/__tests__/tracker-migration.test.ts`
// (`tracker.progress.valuetext`, `mobileTracker.objective.noWeight`).

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
