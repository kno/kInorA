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
 *
 * Accepts an optional `namespace` (mirroring `getTranslations(namespace)`'s
 * real next-intl scoping) so a mocked `getTranslations` can forward the
 * requested namespace and resolve unscoped keys (e.g. `t("title")`) against
 * the SAME sub-tree the real server call would use, instead of silently
 * falling back to the full catalog (which would raise MISSING_MESSAGE for
 * any component that calls `getTranslations("someNamespace")`).
 */
import { createTranslator } from "use-intl/core";
import { catalogs } from "@kinora/i18n";

export function createServerTranslator(locale: "en" | "es" = "en", namespace?: string) {
  // `namespace` is a caller-supplied runtime string, not a literal known at
  // this call site, so it can't satisfy `createTranslator`'s literal-typed
  // `NamespaceKeys` generic — cast narrows only the TYPE-LEVEL namespace
  // param; the real ICU engine still scopes lookups by this value at
  // runtime exactly like `next-intl/server`'s `getTranslations(namespace)`.
  return createTranslator({ locale, messages: catalogs[locale], namespace: namespace as never });
}
