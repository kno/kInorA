import { flattenMessages, type NestedMessages } from "./flatten.js";

export type ParityResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Extracts the set of ICU argument names referenced by a message value:
 * plain interpolation (`{name}`), `plural` (`{n, plural, ...}`), and
 * `select` (`{status, select, ...}`) all bind their leading identifier as an
 * argument name. Nested `plural`/`select` cases (e.g. `{n, plural, one {#
 * item}}`) are intentionally not re-parsed as separate arguments — `#`
 * refers back to the enclosing argument, not a new one.
 */
function argumentNames(value: string): string[] {
  const names = new Set<string>();
  let depth = 0;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];

    if (char === "{") {
      // Only the OUTERMOST `{` of an ICU placeholder introduces an argument
      // name. `plural`/`select` case bodies (e.g. `{one {# day}}`) nest
      // inside that same top-level placeholder and must NOT be re-parsed as
      // separate arguments.
      if (depth === 0) {
        let end = i + 1;
        while (end < value.length && /[a-zA-Z0-9_]/.test(value[end]!)) {
          end++;
        }
        const name = value.slice(i + 1, end);
        if (name.length > 0) names.add(name);
      }
      depth++;
      continue;
    }

    if (char === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return [...names].sort();
}

/**
 * Validates parity between an English (base) and a locale catalog:
 * - identical key sets (recursively, over the flattened shape)
 * - no empty/whitespace-only values
 * - identical ICU argument names per key across both locales
 */
export function validateCatalogParity(en: NestedMessages, locale: NestedMessages): ParityResult {
  const errors: string[] = [];
  const enFlat = flattenMessages(en);
  const localeFlat = flattenMessages(locale);

  const enKeys = new Set(Object.keys(enFlat));
  const localeKeys = new Set(Object.keys(localeFlat));

  for (const key of enKeys) {
    if (!localeKeys.has(key)) {
      errors.push(`Missing key "${key}" in locale "es"`);
    }
  }
  for (const key of localeKeys) {
    if (!enKeys.has(key)) {
      errors.push(`Missing key "${key}" in locale "en"`);
    }
  }

  for (const [key, value] of Object.entries(enFlat)) {
    if (value.trim().length === 0) {
      errors.push(`Empty value for key "${key}" in locale "en"`);
    }
  }
  for (const [key, value] of Object.entries(localeFlat)) {
    if (value.trim().length === 0) {
      errors.push(`Empty value for key "${key}" in locale "es"`);
    }
  }

  for (const key of enKeys) {
    if (!localeKeys.has(key)) continue;

    const enArgs = argumentNames(enFlat[key]!);
    const localeArgs = argumentNames(localeFlat[key]!);
    const argsMatch =
      enArgs.length === localeArgs.length && enArgs.every((arg, index) => arg === localeArgs[index]);

    if (!argsMatch) {
      errors.push(
        `ICU argument mismatch for key "${key}": en has [${enArgs.join(", ")}], locale has [${localeArgs.join(", ")}]`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
