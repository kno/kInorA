import { describe, it, expect } from "vitest";
import { createTranslator } from "use-intl/core";
import { catalogs } from "@kinora/i18n";
import {
  taxonomyLabel,
  taxonomyList,
  taxonomyTerm,
  type TaxonomyTranslator,
} from "../taxonomy";

/**
 * Backed by the REAL production catalogs (not a stub), so a failure here means
 * the shipped translations are genuinely wrong rather than a fixture drifting.
 */
function translator(locale: "en" | "es"): TaxonomyTranslator {
  return createTranslator({
    locale,
    messages: catalogs[locale],
  }) as unknown as TaxonomyTranslator;
}

const en = translator("en");
const es = translator("es");

describe("taxonomyTerm", () => {
  it("translates a known term into Spanish", () => {
    expect(taxonomyTerm(es, "body weight")).toBe("peso corporal");
    expect(taxonomyTerm(es, "lats")).toBe("dorsales");
    expect(taxonomyTerm(es, "hamstrings")).toBe("isquiosurales");
    expect(taxonomyTerm(es, "waist")).toBe("zona media");
  });

  it("returns the normalised English display form", () => {
    expect(taxonomyTerm(en, "body weight")).toBe("body weight");
    expect(taxonomyTerm(en, "ez barbell")).toBe("EZ barbell");
    expect(taxonomyTerm(en, "smith machine")).toBe("Smith machine");
  });

  it("resolves a term shared by several dimensions from ONE definition", () => {
    // `traps`, `lats` and `upper back` appear in both target and
    // secondaryMuscles — they must not be defined twice or diverge.
    for (const shared of ["traps", "lats", "upper back", "biceps", "calves"]) {
      expect(taxonomyTerm(es, shared)).not.toBe(shared);
    }
  });

  it("FALLS BACK to the raw value for an unmapped term", () => {
    // A regenerated upstream catalog must degrade to English, never blank the
    // UI or leak a key path.
    expect(taxonomyTerm(es, "flux capacitors")).toBe("flux capacitors");
    expect(taxonomyTerm(en, "flux capacitors")).toBe("flux capacitors");
  });

  it("never returns an empty string or a visible key path for an unknown term", () => {
    const result = taxonomyTerm(es, "totally unknown muscle");
    expect(result).not.toBe("");
    expect(result).not.toContain("exercises.taxonomy");
  });
});

describe("taxonomyLabel", () => {
  it("capitalises the first character for standalone display", () => {
    expect(taxonomyLabel(es, "peso corporal")).toBe("Peso corporal");
    expect(taxonomyLabel(es, "body weight")).toBe("Peso corporal");
    expect(taxonomyLabel(en, "lats")).toBe("Lats");
  });

  it("preserves meaningful internal capitals that CSS capitalize would corrupt", () => {
    expect(taxonomyLabel(en, "ez barbell")).toBe("EZ barbell");
    expect(taxonomyLabel(en, "skierg machine")).toBe("SkiErg machine");
    expect(taxonomyLabel(es, "ez barbell")).toBe("Barra Z");
  });

  it("capitalises an unmapped term rather than dropping it", () => {
    expect(taxonomyLabel(es, "unknown thing")).toBe("Unknown thing");
  });

  it("tolerates an empty value without throwing", () => {
    expect(taxonomyLabel(es, "")).toBe("");
  });
});

describe("taxonomyList", () => {
  it("translates and joins every term", () => {
    expect(taxonomyList(es, ["hip flexors", "lower back"])).toBe(
      "flexores de la cadera · zona lumbar",
    );
  });

  it("accepts a custom separator", () => {
    expect(taxonomyList(es, ["abs", "obliques"], ", ")).toBe("abdominales, oblicuos");
  });

  it("returns an empty string for an empty list", () => {
    expect(taxonomyList(es, [])).toBe("");
  });

  it("mixes translated and unmapped terms without losing either", () => {
    expect(taxonomyList(es, ["abs", "mystery muscle"])).toBe("abdominales · mystery muscle");
  });
});
