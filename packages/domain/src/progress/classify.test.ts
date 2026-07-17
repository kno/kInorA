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
    // Deadlift decision (documented in classify.ts): ALL deadlift variants,
    // including the plain/conventional lift, classify as hamstrings — see
    // the "Deadlift variants" adversarial block below for the full set.
    ["Deadlift", "hamstrings"],
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

  it("distinguishes 'Leg Curl' (hamstrings, specific phrase) from a bare 'curl' fallback (biceps)", () => {
    // "leg curl" is checked as a specific phrase BEFORE the bare "curl" ->
    // biceps fallback runs, so the hamstring-specific phrase always wins.
    expect(classifyExerciseMuscleGroup("Leg Curl")).toBe("hamstrings");
    expect(classifyExerciseMuscleGroup("Barbell Curl")).toBe("biceps");
    expect(classifyExerciseMuscleGroup("Preacher Curl")).toBe("biceps");
    expect(classifyExerciseMuscleGroup("Concentration Curl")).toBe("biceps");
    expect(classifyExerciseMuscleGroup("Cable Curl")).toBe("biceps");
    expect(classifyExerciseMuscleGroup("Bicep Curl")).toBe("biceps");
  });

  describe("deadlift variants — documented decision: all map to hamstrings", () => {
    it.each([
      ["Deadlift", "hamstrings"],
      ["Romanian Deadlift", "hamstrings"],
      ["Sumo Deadlift", "hamstrings"],
      ["Stiff-Leg Deadlift", "hamstrings"],
      ["Trap-Bar Deadlift", "hamstrings"],
      ["Peso Muerto", "hamstrings"],
      ["Peso Muerto Rumano", "hamstrings"],
    ])('maps "%s" to %s', (title, expected) => {
      expect(classifyExerciseMuscleGroup(title)).toBe(expected);
    });
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

  describe("adversarial — real-world titles NOT equal to seed keywords (Judgment Day PR 1a)", () => {
    it.each([
      // MUST-FIX 1: "fly" bare keyword must not shadow rear-delt phrases.
      ["Reverse Fly", "shoulders"],
      ["Rear Delt Fly", "shoulders"],
      ["Rear Fly", "shoulders"],
      // Genuine chest flys still classify correctly (specific-before-bare
      // precedence must not swallow real chest exercises).
      ["Cable Fly", "chest"],
      ["Dumbbell Fly", "chest"],
      ["Chest Fly", "chest"],
      ["Pec Deck", "chest"],
      // MUST-FIX 2: bare "curl" -> biceps fallback, specific phrases win.
      ["Barbell Curl", "biceps"],
      ["Preacher Curl", "biceps"],
      ["Leg Curl", "hamstrings"],
      // SHOULD-FIX 3: "row" family -> back, except "upright row" -> shoulders.
      ["Upright Row", "shoulders"],
      ["Dumbbell Row", "back"],
      ["Seated Row", "back"],
      ["Cable Row", "back"],
      ["T-Bar Row", "back"],
      ["Pendlay Row", "back"],
      ["Barbell Row", "back"],
      // SHOULD-FIX 4: Spanish plurals classify the same as their singulars.
      ["Elevaciones Laterales", "shoulders"],
      ["Sentadillas", "quads"],
      ["Dominadas", "back"],
      ["Flexiones", "chest"],
      // SHOULD-FIX 5: deadlift variants (documented decision: hamstrings).
      ["Romanian Deadlift", "hamstrings"],
      ["Sentadilla Búlgara", "quads"],
      ["Remo con Barra", "back"],
      // Genuinely unknown titles must still degrade to null.
      ["Mobility Flow", null],
      ["Foam Rolling", null],
    ])('maps "%s" to %s', (title, expected) => {
      expect(classifyExerciseMuscleGroup(title)).toBe(expected);
    });
  });

  describe("adversarial — Round-2 Judgment Day: unguarded substring matching produces wrong-bucket false positives (both blind judges confirmed)", () => {
    it.each([
      // Bare "row" (back) must NOT match inside unrelated words containing
      // "row" as a substring: throw, narrow, crow.
      ["Medicine Ball Throw", null],
      ["Sled Throw", null],
      ["Crow Pose", null],
      // "Narrow Grip Push-up" must not match bare "row" inside "Narrow" —
      // AND must now correctly classify as chest via the new push-up keyword.
      ["Narrow Grip Push-up", "chest"],
      // Bare "rdl" (hamstrings) must NOT match inside "hurdle"/"girdle".
      ["Hurdle Jump", null],
      ["Hurdle Hops", null],
      // Bare "remo" (back, ES) must NOT match inside "extremo".
      ["Press Extremo", null],
      // Bare "core" must NOT match inside "scorecard".
      ["Scorecard", null],
      // Bare "fly" (chest) must NOT match inside "butterfly" (one word) —
      // degrading to null here is the correct, documented trade-off.
      ["Butterfly Stretch", null],
    ])('maps "%s" to %s', (title, expected) => {
      expect(classifyExerciseMuscleGroup(title)).toBe(expected);
    });
  });

  describe("push-up coverage (Judgment Day: most common bodyweight chest exercise, previously null)", () => {
    it.each([
      ["Push-up", "chest"],
      ["Push up", "chest"],
      ["Pushup", "chest"],
      ["Press-up", "chest"],
      ["Lagartija", "chest"],
      ["Lagartijas", "chest"],
      ["Narrow Grip Push-up", "chest"],
    ])('maps "%s" to %s', (title, expected) => {
      expect(classifyExerciseMuscleGroup(title)).toBe(expected);
    });
  });
});
