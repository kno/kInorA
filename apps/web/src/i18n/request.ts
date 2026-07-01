/**
 * Shared i18n request helpers for Next.js Server Component pages.
 *
 * Extracts the repeated plumbing from the auth pages:
 *  - `getFirstParam`   — normalises a string | string[] | undefined query param to string | null
 *  - `resolvePageI18n` — reads the incoming request headers, resolves the
 *                        locale, and loads the message catalogue in one step.
 */

import { headers } from "next/headers";
import { resolveLocale, loadMessages } from "@/i18n/locale";
import type { SupportedLocale, Messages } from "@/i18n/locale";

/**
 * Normalise a Next.js searchParam value (which can be a string, an array of
 * strings, or undefined) to a single string or null.
 *
 * When multiple values are present the first one is used, matching the
 * standard "last writer wins" convention Next.js uses elsewhere.
 */
export function getFirstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export interface PageI18n {
  locale: SupportedLocale;
  messages: Messages;
}

/**
 * Resolve the locale and load the message catalogue for a Server Component
 * page.
 *
 * Resolution order (delegates to `resolveLocale`):
 *  1. `?lang=` query parameter (explicit URL override wins)
 *  2. `Accept-Language` request header
 *  3. English fallback
 *
 * NOTE: `headers()` is async in Next.js 15+ and MUST be awaited here.
 */
export async function resolvePageI18n(langParam: string | null): Promise<PageI18n> {
  const requestHeaders = await headers();
  const acceptLanguage = requestHeaders.get("accept-language");
  const locale: SupportedLocale = resolveLocale(acceptLanguage, langParam);
  const messages = loadMessages(locale);
  return { locale, messages };
}
