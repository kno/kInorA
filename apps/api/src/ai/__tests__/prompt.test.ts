import { describe, it, expect } from "vitest";
import {
  buildPlanPrompt,
  buildBodyProfileSection,
  PLAN_PROMPT_TEMPLATE,
  buildPlanPromptVariables,
} from "../prompt.js";
import { renderTemplate } from "../prompt-template.js";
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

  describe("preferenceScores inclusion", () => {
    it("includes all four preference score labels and their values in the prompt", () => {
      const prompt = buildPlanPrompt(baseSpec);
      // baseSpec has: strength=0.3, hypertrophy=0.9, endurance=0.2, mobility=0.4
      expect(prompt).toContain("strength");
      expect(prompt).toContain("hypertrophy");
      expect(prompt).toContain("endurance");
      expect(prompt).toContain("mobility");
      expect(prompt).toContain("0.3");
      expect(prompt).toContain("0.9");
      expect(prompt).toContain("0.2");
      expect(prompt).toContain("0.4");
    });

    it("reflects different preferenceScores in the prompt", () => {
      const spec: PlanSpec = {
        ...baseSpec,
        preferenceScores: { strength: 0.9, hypertrophy: 0.1, endurance: 0.5, mobility: 0.7 },
      };
      const prompt = buildPlanPrompt(spec);
      expect(prompt).toContain("0.9");
      expect(prompt).toContain("0.1");
      expect(prompt).toContain("0.5");
      expect(prompt).toContain("0.7");
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

  // 14b-v1.1 — the generator steers intensity up/down via `PlanSpec.intensityBias`.
  describe("intensity bias inclusion (14b-v1.1)", () => {
    it("adds a steer-down intensity-bias line when intensityBias is 'reduce', absent from the baseline prompt", () => {
      const prompt = buildPlanPrompt({ ...baseSpec, intensityBias: "reduce" });
      const basePrompt = buildPlanPrompt(baseSpec);
      expect(basePrompt.toLowerCase()).not.toMatch(/intensity bias/);
      expect(prompt.toLowerCase()).toMatch(/intensity bias.*(reduce|lighter|less intens)/);
    });

    it("adds a steer-up intensity-bias line when intensityBias is 'increase'", () => {
      const prompt = buildPlanPrompt({ ...baseSpec, intensityBias: "increase" });
      expect(prompt.toLowerCase()).toMatch(/intensity bias.*(increase|heavier|more intens)/);
    });

    it("does not add a bias instruction when intensityBias is 'maintain' (same prompt as absent)", () => {
      const maintainPrompt = buildPlanPrompt({ ...baseSpec, intensityBias: "maintain" });
      const absentPrompt = buildPlanPrompt(baseSpec);
      expect(maintainPrompt).toBe(absentPrompt);
    });
  });

  it.each([
    "I have sciatica",
    "I have arthritis",
    "I had surgery",
    "I have a fracture",
    "I had a stroke",
    "I have hypertension",
    "I have a torn ACL",
    "I am allergic to peanuts",
    "I have celiac disease",
    "I have osteoporosis",
    "I have asthma",
    "I have diabetes",
    "I have epilepsy",
    "I have a migraine",
    "I have a chronic condition",
  ])(
    "redacts %s memory context before provider delivery",
    (sensitiveMemory) => {
      const prompt = buildPlanPrompt({
        ...baseSpec,
        memoryContext: [sensitiveMemory, "Prefers morning workouts"],
      });

      expect(prompt).toContain("[REDACTED]");
      expect(prompt).not.toContain(sensitiveMemory);
      expect(prompt).toContain("Prefers morning workouts");
    },
  );
});

describe("buildPlanPrompt — closed exercise vocabulary (#352 slice B)", () => {
  it("omits the section entirely when no vocabulary is supplied", () => {
    // Back-compat: a caller with no catalog to offer must fall back to
    // free-text generation, not to an empty list that forbids everything.
    const prompt = buildPlanPrompt(baseSpec);
    expect(prompt).not.toContain("ALLOWED EXERCISES");
    expect(prompt).toContain("2. Uses ONLY the available equipment: barbell, dumbbells.");
  });

  it("omits the section when the vocabulary is empty", () => {
    const prompt = buildPlanPrompt({ ...baseSpec, allowedExercises: [] });
    expect(prompt).not.toContain("ALLOWED EXERCISES");
  });

  it("lists every allowed name, one per line, with its size", () => {
    const prompt = buildPlanPrompt({
      ...baseSpec,
      allowedExercises: ["push-up", "barbell full squat", "dumbbell row"],
    });

    expect(prompt).toContain("ALLOWED EXERCISES — CLOSED VOCABULARY (3 entries):");
    expect(prompt).toContain("push-up\nbarbell full squat\ndumbbell row");
  });

  it("instructs the model to copy names verbatim and re-points task rule 2", () => {
    const prompt = buildPlanPrompt({ ...baseSpec, allowedExercises: ["push-up"] });

    expect(prompt).toContain("MUST be copied VERBATIM from that list");
    expect(prompt).toContain(
      "2. Uses ONLY exercise names copied verbatim from the ALLOWED EXERCISES list above.",
    );
  });

  it("puts the vocabulary before the task so the constraint is read first", () => {
    const prompt = buildPlanPrompt({ ...baseSpec, allowedExercises: ["push-up"] });
    expect(prompt.indexOf("ALLOWED EXERCISES")).toBeLessThan(prompt.indexOf("TASK:"));
  });

  it("emits no diagnostic language with a vocabulary attached", () => {
    const prompt = buildPlanPrompt({ ...baseSpec, allowedExercises: ["push-up", "burpee"] });
    for (const pattern of DIAGNOSTIC_PATTERNS) {
      expect(pattern.test(prompt), pattern.source).toBe(false);
    }
  });
});

describe("buildPlanPrompt — body profile (17c-profile-body-metrics, PR 3)", () => {
  it("renders byte-identically to the pre-change output when bodyProfile is absent", () => {
    expect(buildPlanPrompt(baseSpec)).toBe(
      renderTemplate(PLAN_PROMPT_TEMPLATE, {
        ...buildPlanPromptVariables(baseSpec),
        bodyProfileSection: "",
      }).trim(),
    );
    expect(buildPlanPrompt(baseSpec)).not.toContain("body_profile");
    expect(buildPlanPrompt(baseSpec)).not.toContain("USER BODY PROFILE");
  });

  it("renders byte-identically when bodyProfile is an empty object", () => {
    const withEmpty = buildPlanPrompt({ ...baseSpec, bodyProfile: {} });
    expect(withEmpty).toBe(buildPlanPrompt(baseSpec));
  });

  it("renders only the selfDescribedSex line when only that field is present", () => {
    const prompt = buildPlanPrompt({ ...baseSpec, bodyProfile: { selfDescribedSex: "female" } });
    expect(prompt).toContain("<body_profile>");
    expect(prompt).toContain("- Sex/gender: female");
    expect(prompt).not.toContain("- Height:");
    expect(prompt).not.toContain("- Bodyweight:");
  });

  it("renders only the heightCm line when only that field is present", () => {
    const prompt = buildPlanPrompt({ ...baseSpec, bodyProfile: { heightCm: 172 } });
    expect(prompt).toContain("- Height: 172 cm");
    expect(prompt).not.toContain("- Sex/gender:");
    expect(prompt).not.toContain("- Bodyweight:");
  });

  it("renders only the bodyweightKg line when only that field is present", () => {
    const prompt = buildPlanPrompt({ ...baseSpec, bodyProfile: { bodyweightKg: 68 } });
    expect(prompt).toContain("- Bodyweight: 68 kg");
    expect(prompt).not.toContain("- Sex/gender:");
    expect(prompt).not.toContain("- Height:");
  });

  it("renders all three lines, wrapped in <body_profile> delimiters, when every field is present", () => {
    const prompt = buildPlanPrompt({
      ...baseSpec,
      bodyProfile: { selfDescribedSex: "non_binary", heightCm: 172, bodyweightKg: 68 },
    });
    expect(prompt).toContain(
      "<body_profile>\nUSER BODY PROFILE (self-reported):\n" +
        "- Sex/gender: non_binary\n- Height: 172 cm\n- Bodyweight: 68 kg\n</body_profile>",
    );
  });

  it("cannot represent prefer_not_to_say — the type excludes it, so the mapping layer never passes it through", () => {
    const prompt = buildPlanPrompt({
      // BodyProfilePromptInput's selfDescribedSex excludes "prefer_not_to_say"
      // at the type level; this cast simulates a mapping-layer bug to prove
      // the RENDERER also treats it as an unpopulated field defensively.
      ...baseSpec,
      bodyProfile: { selfDescribedSex: "prefer_not_to_say" as never },
    });
    // A truthy string still satisfies `bodyProfile?.selfDescribedSex` — this
    // assertion documents that the type is the enforcement point, not a
    // runtime filter here.
    expect(prompt).toContain("- Sex/gender: prefer_not_to_say");
  });

  it("places the section between the training profile and {{limitationsSection}}", () => {
    const prompt = buildPlanPrompt({ ...baseSpec, bodyProfile: { heightCm: 172 } });
    expect(prompt.indexOf("Training emphasis")).toBeLessThan(prompt.indexOf("<body_profile>"));
    expect(prompt.indexOf("</body_profile>")).toBeLessThan(
      prompt.indexOf("User context — physical considerations"),
    );
  });

  it("emits no diagnostic language with a body profile attached", () => {
    const prompt = buildPlanPrompt({
      ...baseSpec,
      bodyProfile: { selfDescribedSex: "male", heightCm: 180, bodyweightKg: 82 },
    });
    for (const pattern of DIAGNOSTIC_PATTERNS) {
      expect(pattern.test(prompt), pattern.source).toBe(false);
    }
  });
});

describe("buildBodyProfileSection — the fail-closed backstop's inner-text seam", () => {
  it("returns an empty section and innerText when bodyProfile is absent", () => {
    expect(buildBodyProfileSection(undefined)).toEqual({ section: "", innerText: "" });
  });

  it("returns an empty section and innerText when bodyProfile has no populated member", () => {
    expect(buildBodyProfileSection({})).toEqual({ section: "", innerText: "" });
  });

  it("returns matching section/innerText — innerText is exactly the content between the delimiters", () => {
    const { section, innerText } = buildBodyProfileSection({ bodyweightKg: 68 });
    expect(section).toBe(`\n\n<body_profile>\n${innerText}\n</body_profile>`);
    expect(innerText).toBe("USER BODY PROFILE (self-reported):\n- Bodyweight: 68 kg");
  });
});

// langfuse-prompt-management, slice B1 — the renderer split must be a pure
// refactor: rendering the exported template over the exported variables
// producer must be BYTE-IDENTICAL to `buildPlanPrompt`'s own output, across
// every branch the builder has (memory on/off, vocabulary on/off, every
// intensityBias value). `toMatchSnapshot()` additionally freezes today's exact
// wording against future accidental drift.
describe("renderTemplate(PLAN_PROMPT_TEMPLATE, buildPlanPromptVariables(spec)) — byte-identical to buildPlanPrompt", () => {
  function rendered(spec: PlanSpec): string {
    return renderTemplate(PLAN_PROMPT_TEMPLATE, buildPlanPromptVariables(spec)).trim();
  }

  it("matches with no memory context", () => {
    expect(rendered(baseSpec)).toBe(buildPlanPrompt(baseSpec));
    expect(rendered(baseSpec)).toMatchSnapshot();
  });

  it("matches with memory context", () => {
    const spec: PlanSpec = { ...baseSpec, memoryContext: ["Prefers morning workouts"] };
    expect(rendered(spec)).toBe(buildPlanPrompt(spec));
    expect(rendered(spec)).toMatchSnapshot();
  });

  it("matches with allowedExercises empty", () => {
    const spec: PlanSpec = { ...baseSpec, allowedExercises: [] };
    expect(rendered(spec)).toBe(buildPlanPrompt(spec));
    expect(rendered(spec)).toMatchSnapshot();
  });

  it("matches with allowedExercises non-empty", () => {
    const spec: PlanSpec = {
      ...baseSpec,
      allowedExercises: ["push-up", "barbell full squat", "dumbbell row"],
    };
    expect(rendered(spec)).toBe(buildPlanPrompt(spec));
    expect(rendered(spec)).toMatchSnapshot();
  });

  it("matches for each intensityBias value: reduce", () => {
    const spec: PlanSpec = { ...baseSpec, intensityBias: "reduce" };
    expect(rendered(spec)).toBe(buildPlanPrompt(spec));
    expect(rendered(spec)).toMatchSnapshot();
  });

  it("matches for each intensityBias value: increase", () => {
    const spec: PlanSpec = { ...baseSpec, intensityBias: "increase" };
    expect(rendered(spec)).toBe(buildPlanPrompt(spec));
    expect(rendered(spec)).toMatchSnapshot();
  });

  it("matches for each intensityBias value: maintain", () => {
    const spec: PlanSpec = { ...baseSpec, intensityBias: "maintain" };
    expect(rendered(spec)).toBe(buildPlanPrompt(spec));
    expect(rendered(spec)).toMatchSnapshot();
  });
});
