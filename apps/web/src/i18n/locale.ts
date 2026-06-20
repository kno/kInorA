/**
 * i18n locale resolution — STUB for TDD RED phase.
 * Always returns English; makes all 11 locale tests fail.
 */

export type SupportedLocale = "en" | "es";
export type Messages = Record<string, string>;

const SUPPORTED_LOCALES: ReadonlySet<string> = new Set(["en", "es"]);

export function resolveLocale(
  _acceptLanguage: string | null,
  _langParam: string | null | undefined
): SupportedLocale {
  // Stub: always returns English — tests expecting "es" will fail
  return "en";
}

export function loadMessages(_locale: SupportedLocale): Messages {
  // Stub: returns empty messages — tests checking message content will fail
  return {};
}
