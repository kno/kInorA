import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { catalogs } from "../index";

/**
 * Exercise-taxonomy coverage guard.
 *
 * The exercise catalog is GENERATED (`scripts/import-exercise-catalog.ts`) from
 * an upstream dataset we do not control. If a regeneration introduces a body
 * part, equipment, target or secondary muscle we have not translated, the UI
 * silently falls back to raw English — which is exactly the spanglish this
 * namespace exists to remove. That degradation is deliberate (never blank the
 * UI), so it cannot announce itself at runtime: this test is what makes it
 * loud, at build time, instead.
 *
 * The catalog JSON is read from disk rather than imported, so `@kinora/i18n`
 * stays a leaf package with no dependency on `@kinora/exercise-catalog`.
 */
const CATALOG_PATH = fileURLToPath(
  new URL("../../../exercise-catalog/data/exercises.catalog.json", import.meta.url)
);

interface CatalogRecord {
  bodyPart: string;
  equipment: string;
  target: string;
  muscleGroup: string;
  secondaryMuscles: string[];
}

const records = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as CatalogRecord[];

/** Every distinct taxonomy value the shipped catalog can render. */
function distinctTerms(): string[] {
  const terms = new Set<string>();
  for (const record of records) {
    terms.add(record.bodyPart);
    terms.add(record.equipment);
    terms.add(record.target);
    for (const muscle of record.secondaryMuscles) terms.add(muscle);
  }
  return [...terms].filter(Boolean).sort();
}

const taxonomy = (locale: "en" | "es") =>
  (catalogs[locale].exercises as Record<string, unknown>).taxonomy as Record<string, string>;

describe("exercise taxonomy coverage", () => {
  it("reads a non-empty generated catalog", () => {
    expect(records.length).toBeGreaterThan(1000);
  });

  it("translates EVERY distinct term in the shipped catalog (en)", () => {
    const missing = distinctTerms().filter((term) => !(term in taxonomy("en")));
    expect(missing, `untranslated (en): ${missing.join(", ")}`).toEqual([]);
  });

  it("translates EVERY distinct term in the shipped catalog (es)", () => {
    const missing = distinctTerms().filter((term) => !(term in taxonomy("es")));
    expect(missing, `untranslated (es): ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps en/es taxonomy key sets identical", () => {
    expect(Object.keys(taxonomy("en")).sort()).toEqual(Object.keys(taxonomy("es")).sort());
  });

  it("has no blank translation in either locale", () => {
    for (const locale of ["en", "es"] as const) {
      const blank = Object.entries(taxonomy(locale))
        .filter(([, value]) => typeof value !== "string" || value.trim() === "")
        .map(([key]) => key);
      expect(blank, `blank ${locale} values: ${blank.join(", ")}`).toEqual([]);
    }
  });

  it("actually translates into Spanish rather than echoing English", () => {
    // A guard against a lazily-copied catalog: most ES values must differ from
    // their EN counterpart. A handful legitimately match (`cardio`, `core`,
    // `kettlebell`), so this asserts the bulk, not every entry.
    const en = taxonomy("en");
    const es = taxonomy("es");
    const identical = Object.keys(en).filter((key) => en[key] === es[key]);
    expect(identical.length).toBeLessThan(Object.keys(en).length * 0.1);
  });

  it("defines each term exactly once, so overlapping dimensions cannot diverge", () => {
    // `traps`, `lats`, `biceps`, `calves` and `upper back` appear in more than
    // one dimension; a flat map makes duplication structurally impossible.
    const keys = Object.keys(taxonomy("es"));
    expect(new Set(keys).size).toBe(keys.length);
    for (const shared of ["traps", "lats", "biceps", "calves", "upper back"]) {
      expect(keys).toContain(shared);
    }
  });
});
