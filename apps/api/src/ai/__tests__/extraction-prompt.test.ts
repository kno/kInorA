import { describe, it, expect } from "vitest";
import { buildExtractionPrompt } from "../extraction-prompt.js";
import type { ChatExtractInput } from "../extraction-port.js";

const baseInput: ChatExtractInput = {
  message: "I want to build muscle four days a week",
  currentDraft: {
    goal: "hypertrophy",
    daysPerWeek: 4,
    limitations: [{ text: "lower back pain", isWarning: true }],
  },
  missingFields: ["sessionDurationMinutes", "location", "equipment"],
};

describe("buildExtractionPrompt", () => {
  it("includes the user message so the LLM can extract from it", () => {
    const prompt = buildExtractionPrompt(baseInput);
    expect(prompt).toContain("I want to build muscle four days a week");
  });

  it("masks limitation/health text from the current draft via mask()", () => {
    const prompt = buildExtractionPrompt(baseInput);
    expect(prompt).not.toContain("lower back pain");
    expect(prompt).toContain("[REDACTED]");
  });

  it("masks limitation text even when it appears in the user message", () => {
    const prompt = buildExtractionPrompt({
      ...baseInput,
      message: "I still have lower back pain so keep it light",
    });
    expect(prompt).not.toContain("lower back pain");
    expect(prompt).toContain("[REDACTED]");
  });

  it("redacts unsafe memory context via sanitizeMemoryContext", () => {
    const prompt = buildExtractionPrompt({
      ...baseInput,
      memoryContext: ["I have diabetes", "Prefers morning workouts"],
    });
    expect(prompt).not.toContain("I have diabetes");
    expect(prompt).toContain("Prefers morning workouts");
    expect(prompt).toContain("[REDACTED]");
  });

  it("lists the missing fields to steer deterministic clarifying questions", () => {
    const prompt = buildExtractionPrompt(baseInput);
    expect(prompt).toContain("sessionDurationMinutes");
    expect(prompt).toContain("location");
    expect(prompt).toContain("equipment");
  });

  it("produces a non-empty prompt for an empty draft and no limitations", () => {
    const prompt = buildExtractionPrompt({
      message: "help me get fit",
      currentDraft: {},
    });
    expect(prompt.length).toBeGreaterThan(50);
    expect(prompt).toContain("help me get fit");
  });

  it("is a pure function — same input yields the same prompt", () => {
    expect(buildExtractionPrompt(baseInput)).toBe(buildExtractionPrompt(baseInput));
  });

  it("contains an explicit do-not-diagnose / no-medical-advice instruction", () => {
    const prompt = buildExtractionPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(
      /do not diagnose|do not provide medical advice|not a medical|no medical/,
    );
  });
});
