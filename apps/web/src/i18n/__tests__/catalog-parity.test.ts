import { describe, it, expect } from "vitest";
import enMessages from "../messages/en.json";
import esMessages from "../messages/es.json";

/**
 * Catalog parity guard.
 *
 * Every user-facing literal must exist in BOTH English and Spanish with the
 * same key set and the same interpolation placeholders. This asserts against
 * the RAW catalog files on purpose — not `loadMessages`, which merges English
 * over the target locale and would silently mask a missing Spanish key by
 * falling back to the English value.
 *
 * If this test fails, a key was added or renamed in one catalog but not the
 * other. Fix it by adding the missing key to the other catalog (see
 * AGENTS.md: keep English and Spanish literals in sync).
 */

const en = enMessages as Record<string, string>;
const es = esMessages as Record<string, string>;

/** Extract the set of `{placeholder}` tokens from a message value. */
function placeholders(value: string): string[] {
  return (value.match(/\{[^}]+\}/g) ?? []).sort();
}

describe("i18n catalog parity", () => {
  it("English and Spanish catalogs have the exact same key set", () => {
    const enKeys = Object.keys(en).sort();
    const esKeys = Object.keys(es).sort();

    const missingInEs = enKeys.filter((key) => !(key in es));
    const missingInEn = esKeys.filter((key) => !(key in en));

    expect(missingInEs, "keys present in en.json but missing from es.json").toEqual([]);
    expect(missingInEn, "keys present in es.json but missing from en.json").toEqual([]);
  });

  it("every catalog value is a non-empty string in both languages", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(typeof value === "string" && value.trim().length > 0, `en."${key}" must be a non-empty string`).toBe(true);
    }
    for (const [key, value] of Object.entries(es)) {
      expect(typeof value === "string" && value.trim().length > 0, `es."${key}" must be a non-empty string`).toBe(true);
    }
  });

  it("interpolation placeholders match between English and Spanish for every key", () => {
    for (const key of Object.keys(en)) {
      if (!(key in es)) continue; // key-set parity is covered by the first test
      expect(placeholders(es[key]!), `placeholders for "${key}" must match between en and es`).toEqual(
        placeholders(en[key]!)
      );
    }
  });
});
