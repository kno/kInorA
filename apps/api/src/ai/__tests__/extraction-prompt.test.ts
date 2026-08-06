import { describe, it, expect } from "vitest";
import {
  buildReplyPrompt,
  buildExtractionPrompt,
  REPLY_PROMPT_TEMPLATE,
  EXTRACTION_PROMPT_TEMPLATE,
  buildReplyPromptVariables,
  buildExtractionPromptVariables,
} from "../extraction-prompt.js";
import { renderTemplate } from "../prompt-template.js";
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

const REPLY = "For hypertrophy, 4 days a week of 45 minutes is a solid starting point.";

describe("buildReplyPrompt (Pass 1 — conversational prose)", () => {
  it("includes the user message so the assistant can respond to it", () => {
    const prompt = buildReplyPrompt(baseInput);
    expect(prompt).toContain("I want to build muscle four days a week");
  });

  it("masks limitation/health text from the current draft via mask()", () => {
    const prompt = buildReplyPrompt(baseInput);
    expect(prompt).not.toContain("lower back pain");
    expect(prompt).toContain("[REDACTED]");
  });

  it("masks a KNOWN limitation term even when the user repeats it in this turn's message", () => {
    const prompt = buildReplyPrompt({
      ...baseInput,
      message: "I still have lower back pain so keep it light",
    });
    expect(prompt).not.toContain("lower back pain");
    expect(prompt).toContain("[REDACTED]");
  });

  it("does NOT mask a first-mention health/limitation phrase (accurate, not a bug)", () => {
    const prompt = buildReplyPrompt({
      message: "I have lower back pain, build muscle 4 days",
      currentDraft: {},
    });
    expect(prompt).toContain("lower back pain");
    expect(prompt).not.toContain("[REDACTED]");
  });

  it("redacts unsafe memory context via sanitizeMemoryContext", () => {
    const prompt = buildReplyPrompt({
      ...baseInput,
      memoryContext: ["I have diabetes", "Prefers morning workouts"],
    });
    expect(prompt).not.toContain("I have diabetes");
    expect(prompt).toContain("Prefers morning workouts");
    expect(prompt).toContain("[REDACTED]");
  });

  it("lists the missing fields to steer deterministic clarifying questions", () => {
    const prompt = buildReplyPrompt(baseInput);
    expect(prompt).toContain("sessionDurationMinutes");
    expect(prompt).toContain("location");
    expect(prompt).toContain("equipment");
  });

  it("is a pure function — same input yields the same prompt", () => {
    expect(buildReplyPrompt(baseInput)).toBe(buildReplyPrompt(baseInput));
  });

  it("contains an explicit do-not-diagnose / no-medical-advice instruction", () => {
    const prompt = buildReplyPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(
      /do not diagnose|do not provide medical advice|not a medical|no medical/,
    );
  });

  it("instructs the assistant to reply in the user's own language", () => {
    const prompt = buildReplyPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(
      /same language|user'?s language|language the user|language they use/,
    );
  });

  it("instructs the assistant to ask only one question at a time", () => {
    const prompt = buildReplyPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(/one question at a time|a single question|only one question/);
  });

  it("instructs the assistant to avoid regional idioms/voseo unless the user uses them", () => {
    const prompt = buildReplyPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(/voseo|regional|idiom|neutral/);
  });

  it("instructs a warm, human, non-mechanical tone", () => {
    const prompt = buildReplyPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(/warm|natural|real person|caring|not robotic|conversational/);
  });

  it("instructs the model to NEVER echo the internal context scaffolding in its reply", () => {
    const prompt = buildReplyPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(
      /never repeat|do not repeat|never echo|do not echo|internal context|not.*quote/,
    );
  });

  it("instructs the model to PROPOSE a concrete default when the user asks for a recommendation or is unsure", () => {
    const prompt = buildReplyPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(
      /propose a (concrete|sensible|specific)|suggest a (concrete|sensible|specific)|asks you to decide|is unsure/,
    );
  });

  it("instructs the model NOT to re-ask the same question it just asked", () => {
    const prompt = buildReplyPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(
      /do not (just )?repeat the same question|never ask the same|don't bounce|do not bounce/,
    );
  });

  it("does NOT ask for a structured object / assistantMessage field (this pass is plain prose)", () => {
    // Pass 1 is a plain streaming call — the reply is natural-language prose,
    // never a JSON object with an assistantMessage field.
    const prompt = buildReplyPrompt(baseInput);
    expect(prompt).not.toContain("assistantMessage");
  });
});

describe("buildExtractionPrompt (Pass 2 — seeded with the assistant reply)", () => {
  it("includes the user message so the LLM can extract from it", () => {
    const prompt = buildExtractionPrompt(baseInput, REPLY);
    expect(prompt).toContain("I want to build muscle four days a week");
  });

  it("INCLUDES the assistant reply verbatim so the extraction is consistent with it", () => {
    const prompt = buildExtractionPrompt(baseInput, REPLY);
    expect(prompt).toContain(REPLY);
    // And it labels the reply as the assistant's own words to steer consistency.
    expect(prompt).toMatch(/ASSISTANT REPLY/);
  });

  it("instructs the model to extract values CONSISTENT with the assistant reply", () => {
    const prompt = buildExtractionPrompt(baseInput, REPLY);
    expect(prompt.toLowerCase()).toMatch(/consistent/);
  });

  it("masks limitation/health text from the current draft via mask()", () => {
    const prompt = buildExtractionPrompt(baseInput, REPLY);
    expect(prompt).not.toContain("lower back pain");
    expect(prompt).toContain("[REDACTED]");
  });

  it("masks a KNOWN limitation term even if it appears inside the assistant reply", () => {
    // The seeded reply is part of the assembled prompt and MUST be scrubbed of
    // already-known limitation terms just like the rest of the prompt.
    const prompt = buildExtractionPrompt(baseInput, "Given your lower back pain, let's keep it light.");
    expect(prompt).not.toContain("lower back pain");
    expect(prompt).toContain("[REDACTED]");
  });

  it("does NOT mask a first-mention health/limitation phrase (accurate, not a bug)", () => {
    const prompt = buildExtractionPrompt(
      { message: "I have lower back pain, build muscle 4 days", currentDraft: {} },
      "Understood.",
    );
    expect(prompt).toContain("lower back pain");
    expect(prompt).not.toContain("[REDACTED]");
  });

  it("redacts unsafe memory context via sanitizeMemoryContext", () => {
    const prompt = buildExtractionPrompt(
      { ...baseInput, memoryContext: ["I have diabetes", "Prefers morning workouts"] },
      REPLY,
    );
    expect(prompt).not.toContain("I have diabetes");
    expect(prompt).toContain("Prefers morning workouts");
    expect(prompt).toContain("[REDACTED]");
  });

  it("extracts ONLY the wizard fields and NEVER preferenceScores/confirmed", () => {
    const prompt = buildExtractionPrompt(baseInput, REPLY);
    expect(prompt).toContain("goal");
    expect(prompt).toContain("daysPerWeek");
    expect(prompt).toContain("sessionDurationMinutes");
    expect(prompt).toContain("location");
    expect(prompt).toContain("equipment");
    expect(prompt).toContain("limitations");
    expect(prompt.toLowerCase()).toMatch(/never infer preferencescores|preferencescores or confirmed/);
  });

  it("produces a non-empty prompt for an empty draft and no limitations", () => {
    const prompt = buildExtractionPrompt({ message: "help me get fit", currentDraft: {} }, "Sure!");
    expect(prompt.length).toBeGreaterThan(50);
    expect(prompt).toContain("help me get fit");
  });

  it("is a pure function — same input yields the same prompt", () => {
    expect(buildExtractionPrompt(baseInput, REPLY)).toBe(buildExtractionPrompt(baseInput, REPLY));
  });

  it("contains an explicit do-not-diagnose / no-medical-advice instruction", () => {
    const prompt = buildExtractionPrompt(baseInput, REPLY);
    expect(prompt.toLowerCase()).toMatch(
      /do not diagnose|do not provide medical advice|not a medical|no medical/,
    );
  });
});

// langfuse-prompt-management, slice B1 — the renderer split must be a pure
// refactor: rendering the exported template over the exported variables
// producer must be BYTE-IDENTICAL to the builder's own output. `toMatchSnapshot()`
// additionally freezes today's exact wording against future accidental drift.
describe("renderTemplate(REPLY_PROMPT_TEMPLATE, buildReplyPromptVariables(input)) — byte-identical to buildReplyPrompt", () => {
  it("matches for the base input", () => {
    const rendered = renderTemplate(REPLY_PROMPT_TEMPLATE, buildReplyPromptVariables(baseInput)).trim();
    expect(rendered).toBe(buildReplyPrompt(baseInput));
    expect(rendered).toMatchSnapshot();
  });

  it("matches with an empty draft and no missing fields", () => {
    const input: ChatExtractInput = { message: "help me get fit", currentDraft: {} };
    const rendered = renderTemplate(REPLY_PROMPT_TEMPLATE, buildReplyPromptVariables(input)).trim();
    expect(rendered).toBe(buildReplyPrompt(input));
    expect(rendered).toMatchSnapshot();
  });

  it("matches with memory context", () => {
    const input: ChatExtractInput = {
      ...baseInput,
      memoryContext: ["Prefers morning workouts"],
    };
    const rendered = renderTemplate(REPLY_PROMPT_TEMPLATE, buildReplyPromptVariables(input)).trim();
    expect(rendered).toBe(buildReplyPrompt(input));
    expect(rendered).toMatchSnapshot();
  });
});

describe("renderTemplate(EXTRACTION_PROMPT_TEMPLATE, buildExtractionPromptVariables(input, reply)) — byte-identical to buildExtractionPrompt", () => {
  it("matches for the base input", () => {
    const rendered = renderTemplate(
      EXTRACTION_PROMPT_TEMPLATE,
      buildExtractionPromptVariables(baseInput, REPLY),
    ).trim();
    expect(rendered).toBe(buildExtractionPrompt(baseInput, REPLY));
    expect(rendered).toMatchSnapshot();
  });

  it("matches with an empty draft and no missing fields", () => {
    const input: ChatExtractInput = { message: "help me get fit", currentDraft: {} };
    const rendered = renderTemplate(
      EXTRACTION_PROMPT_TEMPLATE,
      buildExtractionPromptVariables(input, "Sure!"),
    ).trim();
    expect(rendered).toBe(buildExtractionPrompt(input, "Sure!"));
    expect(rendered).toMatchSnapshot();
  });

  it("matches with memory context", () => {
    const input: ChatExtractInput = {
      ...baseInput,
      memoryContext: ["Prefers morning workouts"],
    };
    const rendered = renderTemplate(
      EXTRACTION_PROMPT_TEMPLATE,
      buildExtractionPromptVariables(input, REPLY),
    ).trim();
    expect(rendered).toBe(buildExtractionPrompt(input, REPLY));
    expect(rendered).toMatchSnapshot();
  });
});
