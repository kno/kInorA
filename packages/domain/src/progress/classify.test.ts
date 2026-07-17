import { describe, expect, it } from "vitest";
import { classifyExerciseMuscleGroup } from "./classify.js";

describe("classifyExerciseMuscleGroup (09c-v1 progress domain, Slice 1a)", () => {
  describe.each([
    // EN keyword sets
    ["Bench Press", "chest"],
    ["Lat Pulldown", "back"],
    ["Overhead Press", "shoulders"],
    ["Bicep Curl", "biceps"],
    ["Tricep Pushdown", "triceps"],
    ["Plank", "core"],
    ["Hip Thrust", "glutes"],
    ["Squat", "quads"],
    ["Leg Curl", "hamstrings"],
    ["Calf Raise", "calves"],
    ["Deadlift", "back"],
    ["Romanian Deadlift", "hamstrings"],
    // ES keyword sets — mirror the OpenDesign muscle-library manifest labels
    ["Press de Banca", "chest"],
    ["Remo", "back"],
    ["Press Militar", "shoulders"],
    ["Curl de Bíceps", "biceps"],
    ["Press Francés", "triceps"],
    ["Abdominales", "core"],
    ["Glúteos", "glutes"],
    ["Sentadilla", "quads"],
    ["Isquiosurales", "hamstrings"],
    ["Gemelos", "calves"],
  ])("bilingual keyword matching", (title, expected) => {
    it(`maps "${title}" to ${expected}`, () => {
      expect(classifyExerciseMuscleGroup(title as string)).toBe(expected);
    });
  });

  it("distinguishes 'Leg Curl' (hamstrings) from a bare biceps 'curl' match", () => {
    expect(classifyExerciseMuscleGroup("Leg Curl")).toBe("hamstrings");
    expect(classifyExerciseMuscleGroup("Bicep Curl")).toBe("biceps");
  });

  it("distinguishes 'Romanian Deadlift' (hamstrings) from plain 'Deadlift' (back)", () => {
    expect(classifyExerciseMuscleGroup("Romanian Deadlift")).toBe("hamstrings");
    expect(classifyExerciseMuscleGroup("Deadlift")).toBe("back");
  });

  describe("normalized-title matching (case, whitespace, diacritics)", () => {
    it("is case-insensitive", () => {
      expect(classifyExerciseMuscleGroup("BENCH PRESS")).toBe("chest");
      expect(classifyExerciseMuscleGroup("sentadilla")).toBe("quads");
    });

    it("collapses internal whitespace", () => {
      expect(classifyExerciseMuscleGroup("Bench   Press")).toBe("chest");
      expect(classifyExerciseMuscleGroup("Press   Militar")).toBe("shoulders");
    });

    it("strips diacritics/accents so accented and unaccented variants collapse", () => {
      expect(classifyExerciseMuscleGroup("sentadílla")).toBe("quads");
      expect(classifyExerciseMuscleGroup("Biceps")).toBe("biceps");
      expect(classifyExerciseMuscleGroup("Bíceps")).toBe("biceps");
    });

    it("trims leading/trailing whitespace", () => {
      expect(classifyExerciseMuscleGroup("  Squat  ")).toBe("quads");
    });
  });

  describe("null-degrade for unmapped titles", () => {
    it("returns null for a title with no matching keyword", () => {
      expect(classifyExerciseMuscleGroup("Zorbatron Flux Capacitor Drill")).toBeNull();
    });

    it("returns null for an empty string", () => {
      expect(classifyExerciseMuscleGroup("")).toBeNull();
    });
  });
});
