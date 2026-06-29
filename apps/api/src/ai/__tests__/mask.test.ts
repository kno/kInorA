import { describe, it, expect } from "vitest";
import { mask } from "../mask.js";

describe("mask", () => {
  describe("basic redaction", () => {
    it("replaces a single limitation term with [REDACTED]", () => {
      const result = mask(
        "User has lower back pain. Avoid heavy deadlifts.",
        ["lower back pain"]
      );
      expect(result).toBe("User has [REDACTED]. Avoid heavy deadlifts.");
    });

    it("replaces multiple occurrences of the same term", () => {
      const result = mask(
        "lower back pain exercises for lower back pain sufferers",
        ["lower back pain"]
      );
      expect(result).toBe("[REDACTED] exercises for [REDACTED] sufferers");
    });
  });

  describe("multiple limitation terms", () => {
    it("replaces all distinct limitation terms in the text", () => {
      const result = mask(
        "User reports lower back pain and mild knee discomfort.",
        ["lower back pain", "mild knee discomfort"]
      );
      expect(result).toBe("User reports [REDACTED] and [REDACTED].");
    });

    it("handles overlapping text gracefully — each term independently replaced", () => {
      const result = mask(
        "shoulder pain and shoulder discomfort noted",
        ["shoulder pain", "shoulder discomfort"]
      );
      expect(result).toBe("[REDACTED] and [REDACTED] noted");
    });
  });

  describe("empty limitations (no-op)", () => {
    it("returns the original text unchanged when limitations array is empty", () => {
      const text = "Generate a workout plan for the user.";
      const result = mask(text, []);
      expect(result).toBe(text);
    });

    it("returns the original text unchanged when no limitation matches", () => {
      const text = "Generate a workout plan for the user.";
      const result = mask(text, ["lower back pain"]);
      expect(result).toBe(text);
    });
  });

  describe("case sensitivity", () => {
    it("replaces the term with exact case matching (case-sensitive)", () => {
      // mask uses literal string replacement — case-sensitive by design
      const result = mask(
        "User has Lower Back Pain, not lower back pain.",
        ["lower back pain"]
      );
      // Only the exact-case match is redacted
      expect(result).toContain("[REDACTED]");
      expect(result).toContain("Lower Back Pain");
    });
  });

  describe("empty text edge cases", () => {
    it("returns empty string unchanged when text is empty", () => {
      const result = mask("", ["lower back pain"]);
      expect(result).toBe("");
    });
  });
});
