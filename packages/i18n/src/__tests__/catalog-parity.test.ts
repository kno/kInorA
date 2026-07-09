import { describe, expect, it } from "vitest";
import { validateCatalogParity } from "../catalog-parity.js";

describe("validateCatalogParity", () => {
  it("fails when a key exists in en but not in es, reporting the key and locale", () => {
    const en = { nav: { home: "Home", about: "About" } };
    const es = { nav: { home: "Inicio" } };

    const result = validateCatalogParity(en, es);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("nav.about") && error.includes("es"))).toBe(true);
  });

  it("fails when a key exists in es but not in en, reporting the key and locale", () => {
    const en = { nav: { home: "Home" } };
    const es = { nav: { home: "Inicio", about: "Acerca de" } };

    const result = validateCatalogParity(en, es);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("nav.about") && error.includes("en"))).toBe(true);
  });

  it("passes when both catalogs have identical key sets", () => {
    const en = { nav: { home: "Home", about: "About" } };
    const es = { nav: { home: "Inicio", about: "Acerca de" } };

    const result = validateCatalogParity(en, es);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when a catalog entry is an empty or whitespace-only string", () => {
    const en = { nav: { home: "Home" } };
    const es = { nav: { home: "   " } };

    const result = validateCatalogParity(en, es);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("nav.home") && error.includes("es"))).toBe(true);
  });

  it("fails when the same key defines different ICU argument names across locales", () => {
    const en = { sets: { count: "{count} sets" } };
    const es = { sets: { count: "{total} series" } };

    const result = validateCatalogParity(en, es);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("sets.count"))).toBe(true);
  });

  it("passes when ICU arguments match, including plural and select cases", () => {
    const en = {
      wizard: {
        frequency: {
          days: "{n, plural, one {# day per week} other {# days per week}}",
        },
      },
      plan: {
        selector: {
          option: "{status, select, ready {Ready} generating {Generating} other {Unknown}}",
        },
      },
    };
    const es = {
      wizard: {
        frequency: {
          days: "{n, plural, one {# día por semana} other {# días por semana}}",
        },
      },
      plan: {
        selector: {
          option: "{status, select, ready {Listo} generating {Generando} other {Desconocido}}",
        },
      },
    };

    const result = validateCatalogParity(en, es);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("uses custom locale labels in error messages when provided", () => {
    const en = { nav: { home: "Home", about: "About" } };
    const fr = { nav: { home: "Accueil" } };

    const result = validateCatalogParity(en, fr, { base: "en", locale: "fr" });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("nav.about") && error.includes('in locale "fr"'))).toBe(
      true
    );
  });
});
