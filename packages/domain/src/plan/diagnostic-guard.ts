import type { WorkoutProgram } from "@kinora/contracts";

/**
 * Diagnostic language patterns that MUST NOT appear in generated plan output.
 *
 * These patterns identify medical diagnosis language — language that implies
 * the system is diagnosing the user's health condition rather than providing
 * fitness guidance. Each entry is a case-insensitive regex fragment.
 *
 * Design reference: spec §"No medical diagnosis" requirement.
 */
const DIAGNOSTIC_PATTERNS: RegExp[] = [
  /you have\b/i,
  /you are diagnosed/i,
  /you suffer from/i,
  /your condition/i,
  /your chronic condition/i,
  /\barthritis\b/i,
  /\btendinitis\b/i,
  /\btendinopathy\b/i,
  /\bherniated\b/i,
  /\bdegenerative\b/i,
  /\bsciatica\b/i,
  /\bdiabetes\b/i,
  /\bhypertension\b/i,
  /\bosteoporosis\b/i,
  /\bfibromyalgia\b/i,
  /\bdiagnosis\b/i,
  /\bsyndrome\b/i,
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
