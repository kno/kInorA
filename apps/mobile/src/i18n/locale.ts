/**
 * Locale resolution — pure logic for the mobile i18n boundary.
 *
 * Mirrors the web app's pattern of keeping locale/message resolution in a
 * small, directly-tested pure module (`apps/web/src/i18n/locale.ts`), with
 * the framework glue (React Native's `IntlProvider` wiring) living in
 * `LocaleProvider.tsx` and staying thin.
 */
import { catalogs, flattenMessages, mergeWithBase } from "@kinora/i18n";

export const SUPPORTED_LOCALES = ["en", "es"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** EN is the base/fallback locale — same choice as the web app's `getRequestConfig`. */
export const DEFAULT_LOCALE: SupportedLocale = "en";

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolves the flat, react-intl-ready message map for a given locale: the
 * requested locale's catalog deep-merged over the EN base (so a missing key
 * anywhere in `es` falls back to its EN value, same Gap-2 guarantee web
 * relies on) then flattened to react-intl's expected `id -> string` shape.
 */
export function resolveMessages(locale: SupportedLocale): Record<string, string> {
  return flattenMessages(mergeWithBase(catalogs.en, catalogs[locale]));
}
