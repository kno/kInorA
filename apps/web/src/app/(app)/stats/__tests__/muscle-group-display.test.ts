import { describe, expect, it } from "vitest";
import { toCoarseMuscleGroupBars } from "../muscle-group-display";

describe("toCoarseMuscleGroupBars", () => {
  it("merges quads/hamstrings/calves/glutes into a single 'legs' bucket", () => {
    const bars = toCoarseMuscleGroupBars([
      { muscleGroup: "quads", setCount: 10, volumeKg: 1000 },
      { muscleGroup: "hamstrings", setCount: 5, volumeKg: 500 },
      { muscleGroup: "calves", setCount: 3, volumeKg: 100 },
      { muscleGroup: "glutes", setCount: 2, volumeKg: 200 },
    ]);

    expect(bars).toEqual([{ group: "legs", setCount: 20, percentOfMax: 100 }]);
  });

  it("merges biceps/triceps into a single 'arms' bucket", () => {
    const bars = toCoarseMuscleGroupBars([
      { muscleGroup: "biceps", setCount: 4, volumeKg: 100 },
      { muscleGroup: "triceps", setCount: 6, volumeKg: 150 },
    ]);

    expect(bars).toEqual([{ group: "arms", setCount: 10, percentOfMax: 100 }]);
  });

  it("keeps back/chest/shoulders/core as 1:1 buckets, ordered back, legs, chest, shoulders, arms, core", () => {
    const bars = toCoarseMuscleGroupBars([
      { muscleGroup: "core", setCount: 5, volumeKg: 50 },
      { muscleGroup: "chest", setCount: 20, volumeKg: 400 },
      { muscleGroup: "back", setCount: 15, volumeKg: 300 },
    ]);

    expect(bars.map((bar) => bar.group)).toEqual(["back", "chest", "core"]);
    expect(bars.find((bar) => bar.group === "chest")).toEqual({ group: "chest", setCount: 20, percentOfMax: 100 });
  });

  it("returns an empty array when the distribution is empty (no mapped exercises)", () => {
    expect(toCoarseMuscleGroupBars([])).toEqual([]);
  });
});
