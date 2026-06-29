import { describe, it, expect } from "vitest";
import { buildPlanPrompt } from "../prompt.js";
import type { PlanSpec } from "@kinora/contracts";

// Diagnostic patterns mirrored from @kinora/domain assertNoDiagnosticLanguage
// — we assert the PROMPT itself does not emit diagnostic language.
const DIAGNOSTIC_PATTERNS: RegExp[] = [
  /you have\b/i,
  /you may have\b/i,
  /you are diagnosed/i,
  /you were diagnosed/i,
  /diagnosed with/i,
  /you suffer from/i,
  /suffering from/i,
  /your condition\b/i,
  /your chronic condition/i,
  /your diagnosis\b/i,
  /this indicates\b/i,
  /this suggests a\b/i,
  /symptoms of\b/i,
];

const baseSpec: PlanSpec = {
  goal: "hypertrophy",
  daysPerWeek: 4,
  sessionDurationMinutes: 60,
  location: "gym",
  equipment: ["barbell", "dumbbells"],
  limitations: [
    { text: "lower back pain", isWarning: true },
    { text: "mild knee discomfort", isWarning: true },
  ],
  preferenceScores: {
    strength: 0.3,
    hypertrophy: 0.9,
    endurance: 0.2,
    mobility: 0.4,
  },
  confirmed: true,
};

describe("buildPlanPrompt", () => {
  describe("goal inclusion", () => {
    it("includes the goal in the prompt", () => {
      const prompt = buildPlanPrompt(baseSpec);
      expect(prompt).toContain("hypertrophy");
    });

    it("includes a different goal when provided", () => {
      const spec: PlanSpec = { ...baseSpec, goal: "strength" };
      const prompt = buildPlanPrompt(spec);
      expect(prompt).toContain("strength");
    });
  });

  describe("frequency inclusion", () => {
    it("includes daysPerWeek in the prompt", () => {
      const prompt = buildPlanPrompt(baseSpec);
      expect(prompt).toContain("4");
    });

    it("includes a different frequency when provided", () => {
      const spec: PlanSpec = { ...baseSpec, daysPerWeek: 3 };
      const prompt = buildPlanPrompt(spec);
      expect(prompt).toContain("3");
    });
  });

  describe("equipment inclusion", () => {
    it("includes all equipment items in the prompt", () => {
      const prompt = buildPlanPrompt(baseSpec);
      expect(prompt).toContain("barbell");
      expect(prompt).toContain("dumbbells");
    });

    it("includes bodyweight when equipment is empty", () => {
      const spec: PlanSpec = { ...baseSpec, equipment: [] };
      const prompt = buildPlanPrompt(spec);
      // No equipment → prompt should note this (e.g. bodyweight or no equipment)
      expect(prompt.toLowerCase()).toMatch(/bodyweight|no equipment/);
    });
  });

  describe("location inclusion", () => {
    it("includes the location in the prompt", () => {
      const prompt = buildPlanPrompt(baseSpec);
      expect(prompt).toContain("gym");
    });

    it("includes home when location is home", () => {
      const spec: PlanSpec = { ...baseSpec, location: "home" };
      const prompt = buildPlanPrompt(spec);
      expect(prompt).toContain("home");
    });
  });

  describe("session duration inclusion", () => {
    it("includes sessionDurationMinutes in the prompt", () => {
      const prompt = buildPlanPrompt(baseSpec);
      expect(prompt).toContain("60");
    });
  });

  describe("limitations as context", () => {
    it("includes limitation text in the prompt as context", () => {
      const prompt = buildPlanPrompt(baseSpec);
      expect(prompt).toContain("lower back pain");
      expect(prompt).toContain("mild knee discomfort");
    });

    it("produces a valid prompt with no limitations", () => {
      const spec: PlanSpec = { ...baseSpec, limitations: [] };
      const prompt = buildPlanPrompt(spec);
      // Should still be a non-empty string with other fields
      expect(prompt).toContain("hypertrophy");
      expect(prompt.length).toBeGreaterThan(50);
    });
  });

  describe("do-not-diagnose instruction", () => {
    it('contains an explicit "do not diagnose" instruction', () => {
      const prompt = buildPlanPrompt(baseSpec);
      // The prompt must contain an unambiguous safe-use instruction
      expect(prompt.toLowerCase()).toMatch(
        /do not diagnose|do not provide medical advice|not a medical|no medical/
      );
    });
  });

  describe("prompt itself contains no diagnostic language", () => {
    it("prompt string does not match any diagnostic pattern", () => {
      const prompt = buildPlanPrompt(baseSpec);
      for (const pattern of DIAGNOSTIC_PATTERNS) {
        expect(prompt).not.toMatch(pattern);
      }
    });

    it("prompt with no limitations also contains no diagnostic patterns", () => {
      const spec: PlanSpec = { ...baseSpec, limitations: [] };
      const prompt = buildPlanPrompt(spec);
      for (const pattern of DIAGNOSTIC_PATTERNS) {
        expect(prompt).not.toMatch(pattern);
      }
    });
  });
});
