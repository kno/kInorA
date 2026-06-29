import type { WorkoutProgram } from "@kinora/contracts";

/**
 * Diagnostic language patterns that MUST NOT appear in generated plan output.
 *
 * The guard keys on diagnostic PHRASING and ATTRIBUTION — language where the
 * system is telling the user they HAVE or ARE a medical condition. It does NOT
 * reject bare condition nouns (e.g. "arthritis", "syndrome") because those words
 * appear legitimately in fitness programming ("arthritis-friendly session",
 * "iliotibial band syndrome exercises"). Blocking them would cause false positives
 * that mark valid plans as `failed`.
 *
 * The rule of thumb: a pattern is diagnostic when it attributes a condition TO
 * the user ("you have X", "diagnosed with X", "you suffer from X") or asserts
 * a clinical finding ("this indicates X", "symptoms of X").
 *
 * Design reference: spec §"No medical diagnosis" requirement.
 */
const DIAGNOSTIC_PATTERNS: RegExp[] = [
  // Direct attribution — the most common LLM diagnostic slip
  /you have\b/i,
  /you may have\b/i,
  /you are diagnosed/i,
  /you were diagnosed/i,
  /diagnosed with/i,
  /you suffer from/i,
  /suffering from/i,

  // Possessive condition attribution
  /your condition\b/i,
  /your chronic condition/i,
  /your diagnosis\b/i,

  // Clinical finding / inference attribution
  /this indicates\b/i,
  /this suggests a\b/i,
  /symptoms of\b/i,
];

/**
 * Tests a single string against all diagnostic patterns.
 *
 * @returns The first matching pattern if a violation is found, or undefined.
 */
function findViolatingPattern(text: string): RegExp | undefined {
  return DIAGNOSTIC_PATTERNS.find((pattern) => pattern.test(text));
}

/**
 * Collects all user-visible text strings from a WorkoutProgram for inspection.
 * This includes session titles, exercise names, notes, substitutionNotes,
 * and limitation warnings — every string the user (or a downstream system)
 * might read.
 */
function extractTextStrings(program: WorkoutProgram): string[] {
  const texts: string[] = [];

  for (const warning of program.limitationWarnings) {
    texts.push(warning);
  }

  for (const session of program.weeklySessions) {
    texts.push(session.title);

    for (const exercise of session.exercises) {
      texts.push(exercise.name);
      if (exercise.notes) texts.push(exercise.notes);
      if (exercise.substitutionNote) texts.push(exercise.substitutionNote);
    }
  }

  return texts;
}

/**
 * Asserts that a WorkoutProgram contains no diagnostic language.
 *
 * Scans all user-visible text strings in the program (session titles, exercise
 * names, notes, substitution notes, and limitation warnings) against a curated
 * list of diagnostic patterns.
 *
 * Pure function — no side effects.
 *
 * @param program The workout program to validate.
 * @throws {Error} If any string in the program contains diagnostic language.
 *                 The error message names the offending text and the pattern.
 */
export function assertNoDiagnosticLanguage(program: WorkoutProgram): void {
  const texts = extractTextStrings(program);

  for (const text of texts) {
    const violatingPattern = findViolatingPattern(text);
    if (violatingPattern) {
      throw new Error(
        `Diagnostic language detected in generated plan. ` +
          `Offending text: "${text}". ` +
          `Matched pattern: ${violatingPattern.toString()}. ` +
          `The plan must not contain medical diagnoses or condition-specific language.`,
      );
    }
  }
}
