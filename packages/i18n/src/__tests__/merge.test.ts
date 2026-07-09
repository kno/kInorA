import { describe, expect, it } from "vitest";
import { mergeWithBase } from "../merge.js";

describe("mergeWithBase", () => {
  it("keeps locale values that are present", () => {
    const en = { nav: { home: "Home" } };
    const es = { nav: { home: "Inicio" } };

    expect(mergeWithBase(en, es)).toEqual({ nav: { home: "Inicio" } });
  });

  it("falls back to the base (en) value for a key missing from the locale", () => {
    const en = { nav: { home: "Home", about: "About" } };
    const es = { nav: { home: "Inicio" } };

    expect(mergeWithBase(en, es)).toEqual({
      nav: { home: "Inicio", about: "About" },
    });
  });

  it("preserves a whole namespace missing from the locale (deep merge, not shallow spread)", () => {
    const en = {
      nav: { home: "Home" },
      hero: { title: "Welcome" },
    };
    const es = {
      nav: { home: "Inicio" },
      // `hero` namespace entirely absent from the locale catalog.
    };

    expect(mergeWithBase(en, es)).toEqual({
      nav: { home: "Inicio" },
      hero: { title: "Welcome" },
    });
  });

  it("deep-merges multiple nesting levels", () => {
    const en = {
      tracker: {
        timeline: { meta: { done: "Done", active: "Active", pending: "Pending" } },
      },
    };
    const es = {
      tracker: {
        timeline: { meta: { done: "Hecho" } },
      },
    };

    expect(mergeWithBase(en, es)).toEqual({
      tracker: {
        timeline: { meta: { done: "Hecho", active: "Active", pending: "Pending" } },
      },
    });
  });

  it("retains a namespace present only in the locale catalog", () => {
    const en = { nav: { home: "Home" } };
    const es = {
      nav: { home: "Inicio" },
      promo: { banner: "Oferta especial" },
    };

    expect(mergeWithBase(en, es)).toEqual({
      nav: { home: "Inicio" },
      promo: { banner: "Oferta especial" },
    });
  });
});
