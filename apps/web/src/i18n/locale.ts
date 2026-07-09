/**
 * i18n locale resolution for the kInorA web app.
 *
 * Resolution order:
 * 1. `langParam` (URL query string `?lang=`) — explicit override wins
 * 2. `Accept-Language` header — best-match from supported locales
 * 3. Fallback to English
 */

export type SupportedLocale = "en" | "es";

const SUPPORTED_LOCALES: ReadonlySet<string> = new Set(["en", "es"]);

/**
 * Resolve the locale from the Accept-Language header and an optional
 * URL `?lang=` parameter. The `langParam` always wins when valid;
 * otherwise the first supported match in Accept-Language is used;
 * English is the ultimate fallback.
 */
export function resolveLocale(
  acceptLanguage: string | null,
  langParam: string | null | undefined
): SupportedLocale {
  // 1. Explicit URL parameter wins
  if (langParam !== null && langParam !== undefined) {
    const normalised = langParam.toLowerCase().trim();
    const lang = normalised.split("-")[0] ?? "";
    if (lang && SUPPORTED_LOCALES.has(lang)) {
      return lang as SupportedLocale;
    }
    // Unsupported explicit lang → fallback
    return "en";
  }

  // 2. Parse Accept-Language header
  if (acceptLanguage) {
    const matches = parseAcceptLanguage(acceptLanguage);
    for (const lang of matches) {
      if (SUPPORTED_LOCALES.has(lang)) {
        return lang as SupportedLocale;
      }
    }
  }

  // 3. Default fallback
  return "en";
}

/**
 * Parse an Accept-Language header into an ordered array of
 * language prefixes (lowercase, quality-sorted descending).
 */
function parseAcceptLanguage(header: string): string[] {
  return header
    .split(",")
    .map((entry) => {
      const parts = entry.trim().split(";q=");
      const lang = parts[0]?.trim() ?? "";
      const qPart = parts[1];
      const quality = qPart ? parseFloat(qPart) : 1;
      const prefix = lang.toLowerCase().split("-")[0] ?? "";
      return { prefix, quality };
    })
    .filter((entry): entry is { prefix: string; quality: number } => entry.prefix.length > 0)
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.prefix);
}