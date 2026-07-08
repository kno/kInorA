import { describe, it, expect } from "vitest";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import {
  allSetsDone,
  clamp,
  deriveTrackerModel,
  displayNum,
  exerciseVolume,
  formatMMSS,
  formatRest,
  parseLeadingInt,
} from "../tracker-model";

function session(): WorkoutSessionRecord {
  return {
    id: "sess-1",
    workoutPlanId: "plan-1",
    status: "active",
    startedAt: "2026-07-08T09:00:00.000Z",
    exercises: [
      {
        id: "ex-1",
        workoutSessionId: "sess-1",
        exerciseIndex: 0,
        title: "Bench Press",
        restSeconds: 90,
        setRecords: [
          { id: "s1a", sessionExerciseId: "ex-1", setIndex: 0, targetReps: "8", weightKg: 40, actualReps: 8, completed: true },
          { id: "s1b", sessionExerciseId: "ex-1", setIndex: 1, targetReps: "8", weightKg: 40, completed: false },
        ],
      },
      {
        id: "ex-2",
        workoutSessionId: "sess-1",
        exerciseIndex: 1,
        title: "Incline Fly",
        restSeconds: 60,
        setRecords: [
          { id: "s2a", sessionExerciseId: "ex-2", setIndex: 0, targetReps: "10", completed: false },
        ],
      },
    ],
  };
}

describe("tracker-model formatters/helpers", () => {
  it("clamps into range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("formats whole vs fractional weights", () => {
    expect(displayNum(45)).toBe("45");
    expect(displayNum(42.5)).toBe("42.5");
  });

  it("parses the leading integer from a target-reps string", () => {
    expect(parseLeadingInt("8", 0)).toBe(8);
    expect(parseLeadingInt("8-10", 0)).toBe(8);
    expect(parseLeadingInt(undefined, 3)).toBe(3);
    expect(parseLeadingInt("", 3)).toBe(3);
    expect(parseLeadingInt(12, 0)).toBe(12);
  });

  it("formats elapsed (mm:ss) and rest (m:ss)", () => {
    expect(formatMMSS(5)).toBe("00:05");
    expect(formatMMSS(1427)).toBe("23:47");
    expect(formatRest(90)).toBe("1:30");
    expect(formatRest(5)).toBe("0:05");
    expect(formatMMSS(-10)).toBe("00:00");
  });

  it("computes exercise volume and completion", () => {
    const [ex1, ex2] = session().exercises;
    expect(exerciseVolume(ex1!)).toBe(320); // 40*8 + 40*0
    expect(allSetsDone(ex1!)).toBe(false);
    expect(allSetsDone(ex2!)).toBe(false);
    expect(allSetsDone({ ...ex2!, setRecords: [] })).toBe(false); // empty is not "done"
  });
});

describe("deriveTrackerModel", () => {
  it("derives the active exercise/set, progress and volumes", () => {
    const model = deriveTrackerModel(session());

    expect(model.totalExercises).toBe(2);
    expect(model.activeExercise?.id).toBe("ex-1"); // first with an incomplete set
    expect(model.activeSet?.id).toBe("s1b");
    expect(model.currentExerciseNumber).toBe(1);
    expect(model.currentSetNumber).toBe(2);
    expect(model.totalSetsInExercise).toBe(2);
    expect(model.nextExercise?.id).toBe("ex-2");

    expect(model.totalSets).toBe(3);
    expect(model.completedSets).toBe(1);
    expect(model.percent).toBe(33);
    expect(model.sessionVolume).toBe(320);
    expect(model.activeExerciseVolume).toBe(320);
    expect(model.canRecord).toBe(true);

    expect(model.segments.map((s) => s.state)).toEqual(["active", "pending"]);
    expect(model.timeline[0]).toMatchObject({ index: 1, title: "Bench Press", state: "active" });
  });

  it("marks the session done and blocks recording once every set is complete", () => {
    const s = session();
    s.status = "completed";
    for (const ex of s.exercises) for (const set of ex.setRecords) set.completed = true;

    const model = deriveTrackerModel(s);
    expect(model.isCompleted).toBe(true);
    expect(model.canRecord).toBe(false);
    expect(model.percent).toBe(100);
    // Active falls back to the last exercise when nothing is incomplete.
    expect(model.currentExerciseNumber).toBe(2);
    expect(model.segments.every((seg) => seg.state === "done")).toBe(true);
  });

  it("handles an empty session without throwing", () => {
    const model = deriveTrackerModel({ ...session(), exercises: [] });
    expect(model.totalExercises).toBe(0);
    expect(model.percent).toBe(0);
    expect(model.canRecord).toBe(false);
    expect(model.activeExercise).toBeUndefined();
  });
});
