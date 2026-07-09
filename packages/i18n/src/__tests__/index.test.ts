import { describe, expect, it } from "vitest";
import { catalogs, flattenMessages, mergeWithBase, validateCatalogParity } from "../index.js";
import type { MessageKey } from "../index.js";

// Type-level: `MessageKey` must derive from the REAL shipped catalog shape
// (329 leaf keys — 325 migrated + 3 `plan.error.*` keys promoted in slice 5
// from PlanStatusView's inline WS-lost "error"-state fallback strings, + 1
// `tracker.error.generic` key promoted from PlanTrackerClient/PlanStatusClient's
// inline unknown-error-code fallback) without any manual enumeration — an
// unknown key must fail to type-check, and a real migrated key must
// type-check.
const realKey: MessageKey = "nav.login";
type IsUnknownRealKeyRejected = Extract<"nav.doesNotExist", MessageKey> extends never ? true : false;
const unknownRealKeyRejected: IsUnknownRealKeyRejected = true;

describe("@kinora/i18n package assembly", () => {
  it("exports the full en/es catalogs", () => {
    expect(catalogs.en).toBeDefined();
    expect(catalogs.es).toBeDefined();
  });

  it("the full catalogs pass the parity/ICU-arg guard", () => {
    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("the full catalog carries all 329 migrated leaf keys per locale", () => {
    const flat = flattenMessages(catalogs.en);
    expect(Object.keys(flat)).toHaveLength(329);
  });

  it("flattenMessages + mergeWithBase compose over the full catalogs", () => {
    const merged = mergeWithBase(catalogs.en, catalogs.es);
    const flat = flattenMessages(merged);
    expect(flat["nav.login"]).toBe("Iniciar sesión");
    expect(flat["hero.subtitle"]).toContain("kInorA");
  });

  it("type-level: MessageKey derives from the real 329-key catalog shape (2.2.2)", () => {
    expect(realKey).toBe("nav.login");
    expect(unknownRealKeyRejected).toBe(true);
  });
});
