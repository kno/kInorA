import type { WorkoutProgram, PlanLimitation } from "@kinora/contracts";

/**
 * Supported locales for the deterministic limitation warning (#260).
 *
 * Mirrors the app's two i18n catalogs (`en`, `es`). The domain layer stays
 * framework-agnostic: it holds its OWN neutral templates below and never
 * imports next-intl or the web/mobile catalogs. `en` is the default.
 */
export type WarningLocale = "en" | "es";

/**
 * Localized warning templates (#260). Neutral, professional register — the
 * Spanish copy uses standard `tú` conjugation ("Consulta"/"realizar"), never
 * voseo, to match the rest of the ES catalog. Each builder is pure and takes
 * the raw limitation text verbatim.
 */
const WARNING_TEMPLATES: Record<WarningLocale, (text: string) => string> = {
  en: (text) =>
    `Limitation: ${text} — Consult a professional before attempting exercises that stress this area.`,
  es: (text) =>
    `Limitación: ${text} — Consulta con un profesional antes de realizar ejercicios que exijan esta zona.`,
};

/**
 * Builds the warning message for a given limitation in the requested locale.
 *
 * The message is intentionally advisory — it never diagnoses or hard-blocks.
 * It surfaces the limitation text and recommends professional consultation.
 */
function buildWarningMessage(limitation: PlanLimitation, locale: WarningLocale): string {
  return WARNING_TEMPLATES[locale](limitation.text);
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
 * - `PlanLimitation.isWarning` is intentionally NOT used as a gate.
 *   The domain layer never hard-blocks regardless of that flag. Every
 *   limitation — whether `isWarning` is true or false — becomes a
 *   non-blocking advisory warning. Callers that want to differentiate
 *   UI rendering may inspect the flag themselves, but generation must
 *   always produce a plan.
 *
 * @param program     The generated workout program.
 * @param limitations The user's reported limitations from the PlanSpec.
 * @param locale      Target locale for the warning copy (#260). Defaults to
 *                    `"en"` so existing callers/tests are unaffected.
 * @returns           A new WorkoutProgram with warnings appended (or the
 *                    original reference when there are no new warnings to add).
 */
export function injectLimitationWarnings(
  program: WorkoutProgram,
  limitations: PlanLimitation[],
  locale: WarningLocale = "en",
): WorkoutProgram {
  if (limitations.length === 0) return program;

  const existingWarnings = new Set(program.limitationWarnings);

  const newWarnings: string[] = [];
  for (const limitation of limitations) {
    const message = buildWarningMessage(limitation, locale);
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
