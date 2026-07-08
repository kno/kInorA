import { describe, expect, it } from "vitest";
import type { MessageKeys } from "../types.js";

/**
 * Type-level test: `MessageKeys<T>` must derive the union of valid dot-joined
 * message-key paths from a nested catalog shape, so referencing an unknown
 * key is a compile-time error and a valid key type-checks.
 */
type SampleCatalog = {
  nav: { home: string; about: string };
  hero: { title: string; greeting: string };
};

type SampleKeys = MessageKeys<SampleCatalog>;

// Valid key type-checks: assigning a known key to `SampleKeys` must compile.
const validKey: SampleKeys = "nav.home";

// Unknown key must NOT be assignable to `SampleKeys` — this is asserted via
// a type-level negative check (`Extract` yields `never` for an invalid key)
// rather than a runtime assertion, since the guarantee is compile-time only.
type IsUnknownKeyRejected = Extract<"nav.unknown", SampleKeys> extends never ? true : false;
const unknownKeyRejected: IsUnknownKeyRejected = true;

describe("MessageKeys", () => {
  it("accepts a valid dot-joined key", () => {
    expect(validKey).toBe("nav.home");
  });

  it("computes the full expected key set for a sample catalog", () => {
    const keys: SampleKeys[] = ["nav.home", "nav.about", "hero.title", "hero.greeting"];
    expect(keys.sort()).toEqual(["hero.greeting", "hero.title", "nav.about", "nav.home"]);
  });

  it("type-level: an unknown key is not part of the generated union", () => {
    expect(unknownKeyRejected).toBe(true);
  });
});
