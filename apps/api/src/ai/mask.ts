/**
 * Redacts health-sensitive limitation text from a string.
 *
 * Used to scrub limitation terms from Langfuse trace inputs/outputs
 * before they are sent to the observability backend — health data must
 * not appear in traces (AGENTS.md §72).
 *
 * Pure function — no network, no side effects.
 *
 * @param text - The source string to redact (e.g. a prompt or plan excerpt).
 * @param limitations - Limitation terms to replace. Each term is replaced
 *   with `[REDACTED]` wherever it appears verbatim in the text.
 *   Replacement is case-sensitive and literal (no regex special chars).
 *   Empty array → text returned unchanged (no-op).
 * @returns The redacted string.
 */
export function mask(text: string, limitations: string[]): string {
  if (limitations.length === 0) {
    return text;
  }

  let result = text;
  for (const term of limitations) {
    // Use split+join for a safe literal string replacement (no regex escaping needed)
    result = result.split(term).join("[REDACTED]");
  }
  return result;
}
