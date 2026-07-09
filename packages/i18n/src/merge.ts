import type { NestedMessages } from "./flatten.js";

/**
 * Deep-merges a locale catalog on top of the base (EN) catalog.
 *
 * This is the Gap-2 EN-fallback util: `next-intl` does NOT auto-merge across
 * locales, so a locale catalog missing a key (or an entire namespace) would
 * otherwise render nothing. A locale value wins when present; anything
 * missing from the locale falls back to the base value. This MUST be a deep
 * merge — a shallow `{ ...base, ...locale }` would drop whole namespaces
 * that exist in `base` but are entirely absent from `locale`.
 */
export function mergeWithBase(base: NestedMessages, locale: NestedMessages): NestedMessages {
  const merged: NestedMessages = { ...base };

  for (const [key, localeValue] of Object.entries(locale)) {
    const baseValue = merged[key];

    if (
      typeof baseValue === "object" &&
      baseValue !== null &&
      typeof localeValue === "object" &&
      localeValue !== null
    ) {
      merged[key] = mergeWithBase(baseValue, localeValue);
    } else {
      merged[key] = localeValue;
    }
  }

  return merged;
}
