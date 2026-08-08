import { describe, expect, it } from "vitest";
import type { SessionExerciseRecord, SetRecordDTO, WorkoutSessionRecord } from "@kinora/contracts";
import {
  computeAverageRpe,
  computeSessionVolume,
  computeVolumeTrend,
  extractCompletedSetRpeValues,
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

function session(
  exercises: SessionExerciseRecord[],
  overrides: Partial<WorkoutSessionRecord> = {},
): WorkoutSessionRecord {
  return {
    id: "session-1",
    workoutPlanId: "plan-1",
    status: "completed",
    exercises,
    startedAt: "2026-07-01T00:00:00.000Z",
    completedAt: "2026-07-01T01:00:00.000Z",
    ...overrides,
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

  // 17c-profile-body-metrics PR 4 — bodyweight-set volume.
  describe("bodyweight resolution", () => {
    it("reports 0 volume for a bodyweight-only session when resolvedBodyweightKg is absent", () => {
      const s = session(
        [exercise([set({ weightKg: undefined, actualReps: 15, completed: true })])],
        { resolvedBodyweightKg: undefined },
      );

      expect(computeSessionVolume(s)).toBe(0);
    });

    it("reports non-zero volume for a bodyweight-only session when resolvedBodyweightKg is present", () => {
      const s = session(
        [exercise([set({ weightKg: undefined, actualReps: 15, completed: true })])],
        { resolvedBodyweightKg: 80 },
      );

      expect(computeSessionVolume(s)).toBe(80 * 15);
    });

    it("leaves a loaded set unaffected by resolvedBodyweightKg's presence", () => {
      const s = session(
        [exercise([set({ weightKg: 100, actualReps: 5, completed: true })])],
        { resolvedBodyweightKg: 80 },
      );

      expect(computeSessionVolume(s)).toBe(100 * 5);
    });

    it("still takes the bodyweight fallback for an explicitly-logged 0 kg set", () => {
      // (weightKg ?? 0) > 0, not weightKg == null: a logged 0 kg is
      // indistinguishable from unlogged, and 0 * reps is the lie this
      // change exists to end.
      const s = session(
        [exercise([set({ weightKg: 0, actualReps: 12, completed: true })])],
        { resolvedBodyweightKg: 70 },
      );

      expect(computeSessionVolume(s)).toBe(70 * 12);
    });

    it("excludes an incomplete set from bodyweight volume, unchanged from today", () => {
      const s = session(
        [exercise([set({ weightKg: undefined, actualReps: 15, completed: false })])],
        { resolvedBodyweightKg: 80 },
      );

      expect(computeSessionVolume(s)).toBe(0);
    });
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

// 14b-v1.1 — the RPE adaptation policy's window input is built from ONLY
// completed working sets that recorded an rpe (design.md "session-count
// window"), distinct from computeAverageRpe which includes every set
// (completed or not) that recorded one.
describe("extractCompletedSetRpeValues", () => {
  it("returns [] for a session with no sets", () => {
    expect(extractCompletedSetRpeValues(session([exercise([])]))).toEqual([]);
  });

  it("excludes sets without a recorded rpe", () => {
    const s = session([exercise([set({ rpe: undefined }), set({ rpe: undefined })])]);
    expect(extractCompletedSetRpeValues(s)).toEqual([]);
  });

  it("excludes a set that recorded rpe but is not completed", () => {
    const s = session([exercise([set({ rpe: 9, completed: false })])]);
    expect(extractCompletedSetRpeValues(s)).toEqual([]);
  });

  it("returns the rpe of every completed set that recorded one, across exercises", () => {
    const s = session([
      exercise([set({ rpe: 8, completed: true }), set({ rpe: undefined, completed: true })]),
      exercise([set({ rpe: 6, completed: true })]),
    ]);
    expect(extractCompletedSetRpeValues(s)).toEqual([8, 6]);
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

  it("reflects a resolved bodyweight contribution in the trend delta", () => {
    const current = session(
      [exercise([set({ weightKg: undefined, actualReps: 10, completed: true })])],
      { resolvedBodyweightKg: 80 },
    );
    const prior = session(
      [exercise([set({ weightKg: undefined, actualReps: 10, completed: true })])],
      { resolvedBodyweightKg: undefined },
    );

    expect(computeVolumeTrend(current, prior)).toEqual({
      volumeDelta: 800,
      direction: "up",
    });
  });
});
