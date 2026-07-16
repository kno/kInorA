/**
 * Node (this test's runtime) already has native `Intl.PluralRules`, so this
 * test can't prove the polyfill is what makes Hermes work on device — that
 * proof is the on-device check tracked in issue #117. What this DOES prove:
 * the polyfill module imports cleanly (no missing `Intl.Locale` dependency,
 * no locale-data load failure) and, once loaded, `Intl.PluralRules` selects
 * the correct CLDR category for `en` and `es` — the same rule Hermes would
 * need to apply. If Hermes is ever missing the polyfill, this test would
 * still pass on Node while the app breaks on device; it guards correctness
 * of the polyfill's data, not the Hermes gap itself.
 */
import { describe, expect, it } from "vitest";
import "../intl-polyfill";

describe("intl-polyfill", () => {
  it("resolves the Spanish plural category for one vs. other", () => {
    expect(new Intl.PluralRules("es").select(1)).toBe("one");
    expect(new Intl.PluralRules("es").select(3)).toBe("other");
  });

  it("resolves the English plural category for one vs. other", () => {
    expect(new Intl.PluralRules("en").select(1)).toBe("one");
    expect(new Intl.PluralRules("en").select(3)).toBe("other");
  });
});
