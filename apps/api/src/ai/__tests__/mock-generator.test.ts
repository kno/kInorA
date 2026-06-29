import { describe, it, expect } from "vitest";
import { MockPlanGenerator } from "../mock-generator.js";
import type { PlanSpec } from "@kinora/contracts";

const baseSpec: PlanSpec = {
  goal: "hypertrophy",
  daysPerWeek: 4,
  sessionDurationMinutes: 60,
  location: "gym",
  equipment: ["barbell", "dumbbells"],
  limitations: [{ text: "lower back pain", isWarning: true }],
  preferenceScores: {
    strength: 0.3,
    hypertrophy: 0.9,
    endurance: 0.2,
    mobility: 0.4,
  },
  confirmed: true,
};

describe("MockPlanGenerator", () => {
  describe("weeklySessions count", () => {
    it("returns exactly daysPerWeek sessions for a 4-day spec", async () => {
      const generator = new MockPlanGenerator();
      const program = await generator.generate(baseSpec);
      expect(program.weeklySessions).toHaveLength(4);
    });

    it("returns exactly daysPerWeek sessions for a 3-day spec", async () => {
      const generator = new MockPlanGenerator();
      const spec: PlanSpec = { ...baseSpec, daysPerWeek: 3 };
      const program = await generator.generate(spec);
      expect(program.weeklySessions).toHaveLength(3);
    });

    it("returns exactly daysPerWeek sessions for a 6-day spec", async () => {
      const generator = new MockPlanGenerator();
      const spec: PlanSpec = { ...baseSpec, daysPerWeek: 6 };
      const program = await generator.generate(spec);
      expect(program.weeklySessions).toHaveLength(6);
    });
  });

  describe("determinism", () => {
    it("returns identical results for the same spec on repeated calls", async () => {
      const generator = new MockPlanGenerator();
      const first = await generator.generate(baseSpec);
      const second = await generator.generate(baseSpec);
      expect(first).toEqual(second);
    });

    it("two generator instances produce identical results for the same spec", async () => {
      const gen1 = new MockPlanGenerator();
      const gen2 = new MockPlanGenerator();
      const result1 = await gen1.generate(baseSpec);
      const result2 = await gen2.generate(baseSpec);
      expect(result1).toEqual(result2);
    });
  });

  describe("output shape", () => {
    it("each session has a day number, title, and at least one exercise", async () => {
      const generator = new MockPlanGenerator();
      const program = await generator.generate(baseSpec);
      for (const session of program.weeklySessions) {
        expect(typeof session.day).toBe("number");
        expect(typeof session.title).toBe("string");
        expect(session.title.length).toBeGreaterThan(0);
        expect(session.exercises.length).toBeGreaterThan(0);
      }
    });

    it("each exercise has required fields with valid types", async () => {
      const generator = new MockPlanGenerator();
      const program = await generator.generate(baseSpec);
      for (const session of program.weeklySessions) {
        for (const exercise of session.exercises) {
          expect(typeof exercise.name).toBe("string");
          expect(typeof exercise.sets).toBe("number");
          expect(typeof exercise.reps).toBe("string");
          expect(typeof exercise.restSeconds).toBe("number");
        }
      }
    });

    it("limitationWarnings is an array", async () => {
      const generator = new MockPlanGenerator();
      const program = await generator.generate(baseSpec);
      expect(Array.isArray(program.limitationWarnings)).toBe(true);
    });
  });

  describe("day numbering", () => {
    it("first session has day === 1", async () => {
      const generator = new MockPlanGenerator();
      const program = await generator.generate(baseSpec);
      expect(program.weeklySessions[0]?.day).toBe(1);
    });

    it("days are sequential 1..daysPerWeek for a 4-day spec", async () => {
      const generator = new MockPlanGenerator();
      const program = await generator.generate(baseSpec);
      const days = program.weeklySessions.map((s) => s.day);
      expect(days).toEqual([1, 2, 3, 4]);
    });

    it("days are sequential 1..daysPerWeek for a 3-day spec", async () => {
      const generator = new MockPlanGenerator();
      const spec: PlanSpec = { ...baseSpec, daysPerWeek: 3 };
      const program = await generator.generate(spec);
      const days = program.weeklySessions.map((s) => s.day);
      expect(days).toEqual([1, 2, 3]);
    });
  });

  describe("no network", () => {
    it("resolves synchronously (no real async I/O) within 10ms", async () => {
      const generator = new MockPlanGenerator();
      const start = Date.now();
      await generator.generate(baseSpec);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(10);
    });
  });
});
