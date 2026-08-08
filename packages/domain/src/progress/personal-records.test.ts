import { describe, expect, it } from "vitest";
import { computePersonalRecords, type PersonalRecordSetInput } from "./personal-records.js";

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

  // 17c-profile-body-metrics PR 4 — non-regression pin: bodyweight volume
  // must not change PR computation. `PersonalRecordSetInput` has NO
  // bodyweight member and this design does not add one, so there is no
  // channel by which a resolved bodyweight can reach Epley (design.md "Why
  // PRs cannot move"). `computePersonalRecords` output is byte-identical
  // whether or not the caller resolved a bodyweight for the owning session.
  describe("bodyweight volume non-regression (17c PR 4)", () => {
    const bodyweightOnlyFixture: PersonalRecordSetInput[] = [
      { exerciseTitle: "Pull-up", completed: true, weightKg: 0, actualReps: 8, achievedAt: "2026-06-01T10:00:00.000Z" },
      { exerciseTitle: "Push-up", completed: true, weightKg: null, actualReps: 20, achievedAt: "2026-06-02T10:00:00.000Z" },
    ];
    const mixedFixture: PersonalRecordSetInput[] = [
      ...bodyweightOnlyFixture,
      { exerciseTitle: "Bench Press", completed: true, weightKg: 100, actualReps: 5, achievedAt: "2026-06-03T10:00:00.000Z" },
    ];

    it("shows no estimated-1RM PR for a bodyweight-only exercise, with or without a resolved bodyweight elsewhere in the run", () => {
      // The fixture itself never carries a bodyweight value (there is no
      // field to carry one on) — running it alongside a session that DID
      // resolve a bodyweight (simulated here by the loaded Bench Press
      // entry, whose own session may or may not have `resolvedBodyweightKg`
      // attached upstream) produces an identical PR set either way.
      const withoutLoadedSession = computePersonalRecords(bodyweightOnlyFixture);
      const withLoadedSession = computePersonalRecords(mixedFixture).filter(
        (record) => record.exerciseTitle !== "Bench Press",
      );

      expect(withoutLoadedSession).toEqual([]);
      expect(withLoadedSession).toEqual([]);
    });

    it("pins prCount and personalRecords as byte-identical across the same fixture run twice", () => {
      // Since `resolveBodyweightForSession` output cannot be threaded into
      // `PersonalRecordSetInput` (no field), the pin is that calling this
      // function twice with the identical input is deterministic and
      // unaffected by any out-of-band bodyweight resolution happening
      // elsewhere in the call graph for the same period.
      const first = computePersonalRecords(mixedFixture);
      const second = computePersonalRecords(mixedFixture);

      expect(first).toEqual(second);
      expect(first).toHaveLength(1);
      expect(first[0]!.exerciseTitle).toBe("Bench Press");
    });

    it("does not accept a bodyweight field on PersonalRecordSetInput (compile-time pin)", () => {
      const withExcessField: PersonalRecordSetInput = {
        exerciseTitle: "Bench Press",
        completed: true,
        weightKg: 100,
        actualReps: 5,
        achievedAt: "2026-06-01T10:00:00.000Z",
        // @ts-expect-error — `resolvedBodyweightKg` is not a member of
        // `PersonalRecordSetInput`; this must remain a compile error so a
        // future edit cannot silently open the channel this design refused.
        resolvedBodyweightKg: 80,
      };

      expect(computePersonalRecords([withExcessField])).toHaveLength(1);
    });
  });
});
