import { describe, expect, it } from "vitest";
import type { SessionExerciseRecord, SetRecordDTO, WorkoutSessionRecord } from "@kinora/contracts";
import {
  computeAverageRpe,
  computeSessionVolume,
  computeVolumeTrend,
} from "../session-aggregation.js";

function set(overrides: Partial<SetRecordDTO> = {}): SetRecordDTO {
  return {
    id: "set-1",
    sessionExerciseId: "exercise-1",
    setIndex: 1,
    targetReps: "8-12",
    completed: true,
    ...overrides,
  };
}

function exercise(setRecords: SetRecordDTO[]): SessionExerciseRecord {
  return {
    id: "exercise-1",
    workoutSessionId: "session-1",
    exerciseIndex: 0,
    title: "Bench Press",
    restSeconds: 90,
    setRecords,
  };
}

function session(exercises: SessionExerciseRecord[]): WorkoutSessionRecord {
  return {
    id: "session-1",
    workoutPlanId: "plan-1",
    status: "completed",
    exercises,
    startedAt: "2026-07-01T00:00:00.000Z",
    completedAt: "2026-07-01T01:00:00.000Z",
  };
}

describe("computeSessionVolume", () => {
  it("returns 0 for a session with no exercises", () => {
    expect(computeSessionVolume(session([]))).toBe(0);
  });

  it("returns 0 for a session whose exercises have no sets", () => {
    expect(computeSessionVolume(session([exercise([])]))).toBe(0);
  });

  it("sums weightKg * actualReps across completed sets only", () => {
    const s = session([
      exercise([
        set({ id: "s1", weightKg: 100, actualReps: 5, completed: true }),
        set({ id: "s2", weightKg: 50, actualReps: 10, completed: true }),
        // Not completed — excluded from volume.
        set({ id: "s3", weightKg: 999, actualReps: 999, completed: false }),
      ]),
    ]);

    expect(computeSessionVolume(s)).toBe(100 * 5 + 50 * 10);
  });

  it("treats a completed set missing weightKg or actualReps as 0 contribution", () => {
    const s = session([
      exercise([
        set({ weightKg: 100, actualReps: undefined, completed: true }),
        set({ weightKg: undefined, actualReps: 8, completed: true }),
      ]),
    ]);

    expect(computeSessionVolume(s)).toBe(0);
  });

  it("sums across multiple exercises", () => {
    const s = session([
      exercise([set({ weightKg: 20, actualReps: 10, completed: true })]),
      exercise([set({ weightKg: 30, actualReps: 5, completed: true })]),
    ]);

    expect(computeSessionVolume(s)).toBe(20 * 10 + 30 * 5);
  });
});

describe("computeAverageRpe", () => {
  it("returns undefined for a session with no sets", () => {
    expect(computeAverageRpe(session([exercise([])]))).toBeUndefined();
  });

  it("returns undefined when no set has an rpe recorded", () => {
    const s = session([exercise([set({ rpe: undefined }), set({ rpe: undefined })])]);
    expect(computeAverageRpe(s)).toBeUndefined();
  });

  it("averages rpe across only the sets that recorded one", () => {
    const s = session([
      exercise([set({ rpe: 8 }), set({ rpe: 6 }), set({ rpe: undefined })]),
    ]);

    expect(computeAverageRpe(s)).toBe(7);
  });
});

describe("computeVolumeTrend", () => {
  it("returns undefined when there is no prior session", () => {
    const current = session([exercise([set({ weightKg: 100, actualReps: 5 })])]);
    expect(computeVolumeTrend(current, undefined)).toBeUndefined();
  });

  it("returns direction 'up' with a positive volumeDelta when volume increased", () => {
    const current = session([exercise([set({ weightKg: 100, actualReps: 10 })])]);
    const prior = session([exercise([set({ weightKg: 50, actualReps: 10 })])]);

    expect(computeVolumeTrend(current, prior)).toEqual({
      volumeDelta: 500,
      direction: "up",
    });
  });

  it("returns direction 'down' with a negative volumeDelta when volume decreased", () => {
    const current = session([exercise([set({ weightKg: 50, actualReps: 10 })])]);
    const prior = session([exercise([set({ weightKg: 100, actualReps: 10 })])]);

    expect(computeVolumeTrend(current, prior)).toEqual({
      volumeDelta: -500,
      direction: "down",
    });
  });

  it("returns direction 'flat' when volume is unchanged", () => {
    const current = session([exercise([set({ weightKg: 100, actualReps: 10 })])]);
    const prior = session([exercise([set({ weightKg: 100, actualReps: 10 })])]);

    expect(computeVolumeTrend(current, prior)).toEqual({
      volumeDelta: 0,
      direction: "flat",
    });
  });
});
