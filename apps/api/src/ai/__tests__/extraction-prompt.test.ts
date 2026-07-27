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

  it("masks a KNOWN limitation term even when the user repeats it in this turn's message", () => {
    // currentDraft already knows "lower back pain" (see baseInput) — mask()
    // scrubs it everywhere in the assembled prompt, including a repeat in message.
    const prompt = buildExtractionPrompt({
      ...baseInput,
      message: "I still have lower back pain so keep it light",
    });
    expect(prompt).not.toContain("lower back pain");
    expect(prompt).toContain("[REDACTED]");
  });

  it("does NOT mask a first-mention health/limitation phrase (accurate, not a bug)", () => {
    // currentDraft.limitations is empty — mask() has no known terms to redact,
    // so a health phrase the user introduces for the FIRST time this turn is
    // necessarily visible to the extractor. This is required for extraction to
    // work at all and is documented as the accurate contract, not a leak.
    const prompt = buildExtractionPrompt({
      message: "I have lower back pain, build muscle 4 days",
      currentDraft: {},
    });
    expect(prompt).toContain("lower back pain");
    expect(prompt).not.toContain("[REDACTED]");
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

  it("instructs the assistant to reply in the user's own language", () => {
    const prompt = buildExtractionPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(
      /same language|user'?s language|language the user|language they use/,
    );
  });

  it("instructs the assistant to ask only one question at a time", () => {
    const prompt = buildExtractionPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(/one question at a time|a single question|only one question/);
  });

  it("instructs the assistant to avoid regional idioms/voseo unless the user uses them", () => {
    const prompt = buildExtractionPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(/voseo|regional|idiom|neutral/);
  });

  it("instructs a warm, human, non-mechanical tone", () => {
    const prompt = buildExtractionPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(/warm|natural|real person|caring|not robotic|conversational/);
  });

  it("instructs the model to NEVER echo the internal context scaffolding in its reply", () => {
    const prompt = buildExtractionPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(
      /never repeat|do not repeat|never echo|do not echo|internal context|not.*quote/,
    );
  });

  it("instructs the model to PROPOSE a concrete default when the user asks for a recommendation or is unsure", () => {
    const prompt = buildExtractionPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(
      /propose a (concrete|sensible|specific)|suggest a (concrete|sensible|specific)|asks you to decide|is unsure/,
    );
  });

  it("instructs the model NOT to re-ask the same question it just asked", () => {
    const prompt = buildExtractionPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(
      /do not (just )?repeat the same question|never ask the same|don't bounce|do not bounce/,
    );
  });
});
