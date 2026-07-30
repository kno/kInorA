import { describe, it, expect } from "vitest";
import { cleanLimitationNotes } from "../limitation-notes";

describe("cleanLimitationNotes (issue #250)", () => {
  it("extracts only the limitation text from an EN domain template string", () => {
    const input = [
      "Limitation: lower back pain — Consult a professional before attempting exercises that stress this area.",
    ];
    expect(cleanLimitationNotes(input)).toEqual(["Lower back pain"]);
  });

  it("extracts only the limitation text from an ES domain template string", () => {
    const input = [
      "Limitación: dolor lumbar — Consulta con un profesional antes de realizar ejercicios que exijan esta zona.",
    ];
    expect(cleanLimitationNotes(input)).toEqual(["Dolor lumbar"]);
  });

  it("dedupes identical inputs, preserving first-seen order", () => {
    const input = [
      "Limitation: knee injury — Consult a professional before attempting exercises that stress this area.",
      "Limitation: knee injury — Consult a professional before attempting exercises that stress this area.",
      "Limitation: shoulder impingement — Consult a professional before attempting exercises that stress this area.",
    ];
    expect(cleanLimitationNotes(input)).toEqual([
      "Knee injury",
      "Shoulder impingement",
    ]);
  });

  it("keeps a legacy/free-form string without a ' — ' separator verbatim (trimmed)", () => {
    const input = ["  Avoid overhead movements  "];
    expect(cleanLimitationNotes(input)).toEqual(["Avoid overhead movements"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(cleanLimitationNotes([])).toEqual([]);
  });
});
