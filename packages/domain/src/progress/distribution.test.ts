import { describe, expect, it } from "vitest";
import { computeMuscleGroupDistribution } from "./distribution.js";

describe("computeMuscleGroupDistribution", () => {
  it("aggregates set count + volume per group across multiple exercises in the same group", () => {
    const rows = computeMuscleGroupDistribution([
      { muscleGroup: "back", setCount: 3, volumeKg: 300 },
      { muscleGroup: "back", setCount: 2, volumeKg: 150 },
      { muscleGroup: "quads", setCount: 4, volumeKg: 400 },
    ]);

    expect(rows).toEqual([
      { muscleGroup: "back", setCount: 5, volumeKg: 450 },
      { muscleGroup: "quads", setCount: 4, volumeKg: 400 },
    ]);
  });

  it("excludes exercises with no muscle-group mapping (null) without erroring", () => {
    const rows = computeMuscleGroupDistribution([
      { muscleGroup: "chest", setCount: 3, volumeKg: 200 },
      { muscleGroup: null, setCount: 5, volumeKg: 500 },
    ]);

    expect(rows).toEqual([{ muscleGroup: "chest", setCount: 3, volumeKg: 200 }]);
  });

  it("returns an empty array when there is no data", () => {
    expect(computeMuscleGroupDistribution([])).toEqual([]);
  });

  it("returns an empty array when every exercise is unmapped", () => {
    expect(
      computeMuscleGroupDistribution([{ muscleGroup: null, setCount: 2, volumeKg: 100 }])
    ).toEqual([]);
  });

  it("orders rows by the canonical MUSCLE_GROUPS order, not input order", () => {
    const rows = computeMuscleGroupDistribution([
      { muscleGroup: "calves", setCount: 1, volumeKg: 10 },
      { muscleGroup: "chest", setCount: 1, volumeKg: 20 },
    ]);

    expect(rows.map((row) => row.muscleGroup)).toEqual(["chest", "calves"]);
  });
});
