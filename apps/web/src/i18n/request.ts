/**
 * Shared i18n request helpers for Next.js Server Component pages.
 *
 * Extracts the repeated plumbing from the auth pages:
 *  - `getFirstParam`   — normalises a string | string[] | undefined query param to string | null
 *  - `resolvePageI18n` — reads the incoming request headers, resolves the
 *                        locale, and loads the message catalogue in one step.
 *
 * This file is ALSO the target of `createNextIntlPlugin` (see
 * `next.config.ts`) via its default export — `getRequestConfig` below wires
 * next-intl's server/client runtime to the same locale-resolution logic,
 * without touching `getFirstParam`/`resolvePageI18n`, which stay live until
 * their call-sites migrate in later slices.
 */

import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { catalogs, mergeWithBase } from "@kinora/i18n";
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

/**
 * next-intl's request configuration, consumed via `createNextIntlPlugin` and
 * the server/client runtime (`NextIntlClientProvider`, `useTranslations`,
 * `getTranslations`, …).
 *
 * Resolution order (delegates to the EXISTING `resolveLocale`, unchanged):
 *  1. `x-kinora-lang` header — set by `src/proxy.ts` from `?lang=`
 *     (absent/deleted when `?lang=` is not present on the request, so this
 *     falls through to Accept-Language exactly like a bare `langParam`)
 *  2. `Accept-Language` request header
 *  3. English fallback
 *
 * Messages are deep-merged over the English base (`mergeWithBase`) so a key
 * missing from the active locale's catalogue still resolves — next-intl does
 * NOT do this merge itself. `onError` swallows `MISSING_MESSAGE` so a single
 * missing key never crashes the render.
 */
export default getRequestConfig(async () => {
  const requestHeaders = await headers();
  const acceptLanguage = requestHeaders.get("accept-language");
  const xLangHeader = requestHeaders.get("x-kinora-lang");
  const locale: SupportedLocale = resolveLocale(acceptLanguage, xLangHeader);
  const messages = mergeWithBase(catalogs.en, catalogs[locale]);

  return {
    locale,
    messages,
    // Global default so `useFormatter`/`getFormatter` date formatting (Gap 1 —
    // PlanSelector) doesn't fall back to the server's local runtime zone,
    // which would risk a server/client hydration mismatch. All plan/session
    // timestamps are stored and rendered as UTC ISO strings server-side.
    timeZone: "UTC",
    onError(error) {
      if (error.code !== "MISSING_MESSAGE") {
        console.error(error);
      }
    },
    getMessageFallback({ key }) {
      return key;
    },
  };
});
