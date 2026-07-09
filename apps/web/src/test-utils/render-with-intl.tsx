/**
 * `renderWithIntl` — test helper wrapping RTL's `render` in a
 * `NextIntlClientProvider` seeded with the real EN catalog from
 * `@kinora/i18n`. Components under test that call `useTranslations`/
 * `useFormatter` need this provider in the tree; without it next-intl
 * throws (`useTranslations` requires the context to be set).
 *
 * Uses the FULL production catalog (not a stub) so a test failure here means
 * the component genuinely renders the wrong catalog key, not a mismatched
 * fixture.
 */
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { catalogs } from "@kinora/i18n";

// Sourced from `render`'s own resolved React types rather than a separate
// `import type { ReactNode } from "react"` — this monorepo hoists two
// physical (but same-version) `@types/react` copies, and TS treats them as
// distinct nominal types across that import boundary.
type UI = Parameters<typeof render>[0];

export function renderWithIntl(ui: UI, options?: RenderOptions) {
  return render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      {ui}
    </NextIntlClientProvider>,
    options,
  );
}
