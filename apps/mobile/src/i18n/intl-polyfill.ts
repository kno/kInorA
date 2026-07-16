/**
 * Hermes (React Native's JS engine) does NOT ship `Intl.PluralRules`
 * natively. `react-intl` resolves ICU `{n, plural, one{...} other{...}}`
 * messages via `Intl.PluralRules`, so without this polyfill the mobile
 * tracker's ES/EN plural messages would throw or silently fall back to
 * the wrong CLDR rule on device.
 *
 * This must be the FIRST import in `App.tsx` — it has to run before
 * `LocaleProvider` mounts `IntlProvider`, otherwise `react-intl` would
 * already have looked up (and cached) a missing/incorrect
 * `Intl.PluralRules` implementation.
 *
 * Load order matters: `Intl.Locale` first, since `@formatjs/intl-pluralrules`
 * depends on it to parse locale identifiers, then `Intl.PluralRules` itself,
 * then its `en`/`es` locale data (the two locales this app ships).
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
