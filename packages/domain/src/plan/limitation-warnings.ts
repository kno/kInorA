import type { WorkoutProgram, PlanLimitation } from "@kinora/contracts";

/**
 * Builds the warning message for a given limitation.
 *
 * The message is intentionally advisory — it never diagnoses or hard-blocks.
 * It surfaces the limitation text and recommends professional consultation.
 */
function buildWarningMessage(limitation: PlanLimitation): string {
  return `Limitation: ${limitation.text} — Consult a professional before attempting exercises that stress this area.`;
}

/**
 * Injects limitation warnings into a workout program.
 *
 * For each limitation in the provided list, appends a warning message to
 * `program.limitationWarnings` — ONLY if an equivalent warning does not
 * already exist (deduplication by exact string match).
 *
 * Rules:
 * - Pure function — never mutates the input program.
 * - Never hard-blocks: the program's sessions are returned unchanged.
 * - Never diagnoses: warnings are advisory suggestions only.
 * - No duplicate warnings: skips any limitation whose generated message
 *   already appears in the existing `limitationWarnings` array.
 *
 * @param program     The generated workout program.
 * @param limitations The user's reported limitations from the PlanSpec.
 * @returns           A new WorkoutProgram with warnings appended (or the
 *                    original reference when there are no new warnings to add).
 */
export function injectLimitationWarnings(
  program: WorkoutProgram,
  limitations: PlanLimitation[],
): WorkoutProgram {
  if (limitations.length === 0) return program;

  const existingWarnings = new Set(program.limitationWarnings);

  const newWarnings: string[] = [];
  for (const limitation of limitations) {
    const message = buildWarningMessage(limitation);
    if (!existingWarnings.has(message)) {
      newWarnings.push(message);
      existingWarnings.add(message); // prevent duplicates within the same call
    }
  }

  if (newWarnings.length === 0) return program;

  return {
    ...program,
    limitationWarnings: [...program.limitationWarnings, ...newWarnings],
  };
}
