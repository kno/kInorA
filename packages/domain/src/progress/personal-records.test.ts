import { describe, expect, it } from "vitest";
import { computePersonalRecords } from "./personal-records.js";

describe("computePersonalRecords", () => {
  it("computes the estimated 1RM via the Epley formula from the best eligible set", () => {
    const records = computePersonalRecords([
      { exerciseTitle: "Bench Press", completed: true, weightKg: 100, actualReps: 5, achievedAt: "2026-06-01T10:00:00.000Z" },
    ]);

    // 100 * (1 + 5/30) = 116.666...
    expect(records).toHaveLength(1);
    expect(records[0]!.exerciseTitle).toBe("Bench Press");
    expect(records[0]!.estimated1RM).toBeCloseTo(116.6667, 3);
    expect(records[0]!.achievedAt).toBe("2026-06-01T10:00:00.000Z");
    expect(records[0]!.trend).toBeUndefined();
  });

  it("excludes bodyweight, no-weight/assisted, and null-reps sets (omitted, not zeroed)", () => {
    const records = computePersonalRecords([
      { exerciseTitle: "Pull-up", completed: true, weightKg: 0, actualReps: 8, achievedAt: "2026-06-01T10:00:00.000Z" },
      { exerciseTitle: "Pull-up", completed: true, weightKg: null, actualReps: 8, achievedAt: "2026-06-02T10:00:00.000Z" },
      { exerciseTitle: "Pull-up", completed: true, weightKg: 20, actualReps: null, achievedAt: "2026-06-03T10:00:00.000Z" },
      { exerciseTitle: "Pull-up", completed: false, weightKg: 20, actualReps: 8, achievedAt: "2026-06-04T10:00:00.000Z" },
    ]);

    expect(records).toEqual([]);
  });

  it("groups sets by normalized title (case/accent/spacing-insensitive) into one record", () => {
    const records = computePersonalRecords([
      { exerciseTitle: "Sentadilla", completed: true, weightKg: 80, actualReps: 5, achievedAt: "2026-06-01T10:00:00.000Z" },
      { exerciseTitle: "sentadílla", completed: true, weightKg: 100, actualReps: 3, achievedAt: "2026-06-08T10:00:00.000Z" },
    ]);

    expect(records).toHaveLength(1);
    // 100 * (1 + 3/30) = 110 beats 80 * (1 + 5/30) = 93.33
    expect(records[0]!.estimated1RM).toBeCloseTo(110, 3);
  });

  it("keeps the best set from each calendar day, builds an ascending trend series, and returns a signed delta", () => {
    const records = computePersonalRecords([
      { exerciseTitle: "Deadlift", completed: true, weightKg: 100, actualReps: 5, achievedAt: "2026-06-01T10:00:00.000Z" },
      { exerciseTitle: "Deadlift", completed: true, weightKg: 90, actualReps: 5, achievedAt: "2026-06-01T11:00:00.000Z" }, // same day, weaker
      { exerciseTitle: "Deadlift", completed: true, weightKg: 120, actualReps: 5, achievedAt: "2026-06-15T10:00:00.000Z" },
    ]);

    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record!.trend).toBeDefined();
    expect(record!.trend!.series).toHaveLength(2);
    expect(record!.trend!.series[1]).toBeGreaterThan(record!.trend!.series[0]!);
    expect(record!.trend!.delta).toBeCloseTo(record!.trend!.series[1]! - record!.trend!.series[0]!, 6);
    expect(record!.trend!.delta).toBeGreaterThan(0);
  });

  it("returns a negative signed delta when the most recent PR is lower than the prior one", () => {
    const records = computePersonalRecords([
      { exerciseTitle: "Overhead Press", completed: true, weightKg: 60, actualReps: 5, achievedAt: "2026-06-01T10:00:00.000Z" },
      { exerciseTitle: "Overhead Press", completed: true, weightKg: 50, actualReps: 5, achievedAt: "2026-06-10T10:00:00.000Z" },
    ]);

    expect(records[0]!.trend!.delta).toBeLessThan(0);
  });

  it("returns an empty array for no input", () => {
    expect(computePersonalRecords([])).toEqual([]);
  });
});
