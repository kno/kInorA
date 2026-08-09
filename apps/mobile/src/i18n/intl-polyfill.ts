/**
 * Hermes (React Native's JS engine) does NOT ship `Intl.PluralRules` or
 * `Intl.ListFormat` natively. `react-intl` resolves ICU
 * `{n, plural, one{...} other{...}}` messages via `Intl.PluralRules`, so
 * without that polyfill the mobile tracker's ES/EN plural messages would
 * throw or silently fall back to the wrong CLDR rule on device.
 * `intl.formatList` — used by the tracker to name the days a plan still has
 * (kno/kInorA#409) — needs `Intl.ListFormat` the same way: `@formatjs/intl`
 * captures `Intl.ListFormat` when the formatters are created and, when it is
 * missing, returns the raw unjoined values instead of "1, 2 and 4".
 *
 * This must be the FIRST import in `App.tsx` — it has to run before
 * `LocaleProvider` mounts `IntlProvider`, otherwise `react-intl` would
 * already have looked up (and cached) a missing/incorrect
 * `Intl.PluralRules` implementation.
 *
 * Load order matters: `Intl.Locale` first, since `@formatjs/intl-pluralrules`
 * and `@formatjs/intl-listformat` depend on it to parse locale identifiers,
 * then each polyfill itself, then its `en`/`es` locale data (the two locales
 * this app ships).
 *
 * Each polyfill guards itself with `shouldPolyfill()` so this file is a
 * no-op once a Hermes release ships native support.
 */
import { shouldPolyfill as shouldPolyfillLocale } from "@formatjs/intl-locale/should-polyfill.js";

if (shouldPolyfillLocale()) {
  require("@formatjs/intl-locale/polyfill.js");
}

import { shouldPolyfill as shouldPolyfillPluralRules } from "@formatjs/intl-pluralrules/should-polyfill.js";

if (shouldPolyfillPluralRules()) {
  require("@formatjs/intl-pluralrules/polyfill.js");
  require("@formatjs/intl-pluralrules/locale-data/en.js");
  require("@formatjs/intl-pluralrules/locale-data/es.js");
}

import { shouldPolyfill as shouldPolyfillListFormat } from "@formatjs/intl-listformat/should-polyfill.js";

if (shouldPolyfillListFormat()) {
  require("@formatjs/intl-listformat/polyfill.js");
  require("@formatjs/intl-listformat/locale-data/en.js");
  require("@formatjs/intl-listformat/locale-data/es.js");
}
