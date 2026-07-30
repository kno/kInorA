/**
 * Presentation helper for plan limitation warnings (issue #250).
 *
 * The domain emits one fully-localized advisory string per user limitation, e.g.
 *   EN: "Limitation: <text> — Consult a professional before attempting exercises
 *        that stress this area."
 *   ES: "Limitación: <text> — Consulta con un profesional antes de realizar
 *        ejercicios que exijan esta zona."
 *
 * Rendered raw this repeats the identical advisory tail on every bullet. For the
 * web plan screens we instead show the limitation TEXT as bullets and the
 * advisory ONCE (via the `plan.limitation.advisory` i18n key). This helper
 * extracts just the per-limitation text.
 *
 * NOTE: this intentionally parses the domain string format (splitting on the
 * " — " advisory separator and stripping the "Limitation:"/"Limitación:"
 * prefix). The coupling to that format is accepted for this presentation-only
 * fix per #250; the domain remains the source of truth and is not modified.
 *
 * Framework-agnostic: no React imports.
 */

/** Advisory separator emitted by the domain: space, em-dash (U+2014), space. */
const ADVISORY_SEPARATOR = " — ";

/** Case-insensitive leading prefixes emitted by the domain (EN + ES). */
const PREFIX_PATTERN = /^(?:limitation|limitación):\s*/i;

/**
 * Clean the raw domain limitation warnings into de-duplicated, prefix-stripped
 * per-limitation texts suitable for bullet rendering.
 *
 * For each warning:
 *   - Drop the advisory tail (everything from the first " — " separator on).
 *   - Strip a leading "Limitation: " / "Limitación: " prefix (case-insensitive).
 *   - Trim, then capitalize the first character only.
 *   - Fallback: a string with no " — " separator (e.g. a legacy/free-form note)
 *     is kept as its trimmed original, unchanged.
 * Duplicates are removed, preserving first-seen order.
 */
export function cleanLimitationNotes(warnings: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const warning of warnings) {
    const separatorIndex = warning.indexOf(ADVISORY_SEPARATOR);

    let cleaned: string;
    if (separatorIndex === -1) {
      // Fallback: no advisory separator — keep the trimmed original verbatim.
      cleaned = warning.trim();
    } else {
      const head = warning.slice(0, separatorIndex);
      const withoutPrefix = head.replace(PREFIX_PATTERN, "").trim();
      cleaned =
        withoutPrefix.length > 0
          ? withoutPrefix.charAt(0).toUpperCase() + withoutPrefix.slice(1)
          : withoutPrefix;
    }

    if (cleaned.length > 0 && !seen.has(cleaned)) {
      seen.add(cleaned);
      result.push(cleaned);
    }
  }

  return result;
}
