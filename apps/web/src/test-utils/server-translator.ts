/**
 * `createServerTranslator` — builds a real catalog-backed `t()` function for
 * mocking `next-intl/server`'s `getTranslations` in tests.
 *
 * Server Components can't run next-intl's actual RSC build under Vitest
 * (selecting it requires the "react-server" resolve condition Next's own
 * bundler sets, which isn't present here — same constraint documented in
 * `apps/web/src/i18n/__tests__/request.test.ts`). `createTranslator` is the
 * same ICU engine next-intl's real `getTranslations`/`useTranslations` use
 * under the hood, seeded with the REAL production catalog for the requested
 * locale, so a test failure means the component genuinely renders the wrong
 * catalog key. Defaults to "en" so existing EN-only call-sites keep working
 * unchanged; pass "es" to assert real Spanish output.
 */
import { createTranslator } from "use-intl/core";
import { catalogs } from "@kinora/i18n";

export function createServerTranslator(locale: "en" | "es" = "en") {
  return createTranslator({ locale, messages: catalogs[locale] });
}
