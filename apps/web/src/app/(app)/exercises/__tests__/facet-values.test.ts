import { describe, it, expect } from "vitest";
import { FACET_VALUE_SEPARATOR, joinFacetValues, splitFacetValues } from "../facet-values";

describe("joinFacetValues", () => {
  it("writes a multi-value selection as ONE query-parameter value", () => {
    expect(joinFacetValues(["chest", "cardio"])).toBe("chest,cardio");
  });

  it("keeps a single value untouched", () => {
    expect(joinFacetValues(["chest"])).toBe("chest");
  });

  it("yields an empty string for an empty selection, so callers omit the key", () => {
    expect(joinFacetValues([])).toBe("");
  });
});

describe("splitFacetValues", () => {
  it("reads the joined form the library writes", () => {
    expect(splitFacetValues("chest,cardio")).toEqual(["chest", "cardio"]);
  });

  it("ALSO reads the repeated-key form a native no-JS submit produces", () => {
    // A `<form method="get">` with several checked boxes of the same name can
    // only send repeated keys, and the App Router delivers those as an array.
    // Refusing to read them would break the no-JS path outright.
    expect(splitFacetValues(["chest", "cardio"])).toEqual(["chest", "cardio"]);
  });

  it("reads a mixture of the two, which a hand-edited URL can produce", () => {
    expect(splitFacetValues(["chest,cardio", "back"])).toEqual(["chest", "cardio", "back"]);
  });

  it("preserves the given order and de-duplicates", () => {
    expect(splitFacetValues("cardio,chest,cardio")).toEqual(["cardio", "chest"]);
  });

  it("trims and drops blanks, so `?k=,` never becomes a filter that matches nothing", () => {
    expect(splitFacetValues(" chest , , cardio ")).toEqual(["chest", "cardio"]);
    expect(splitFacetValues(",")).toEqual([]);
    expect(splitFacetValues("")).toEqual([]);
  });

  it("treats an absent key as no selection", () => {
    expect(splitFacetValues(undefined)).toEqual([]);
    expect(splitFacetValues([])).toEqual([]);
  });

  it("round-trips whatever joinFacetValues produced", () => {
    // The property the whole encoding rests on: one occurrence in, the same
    // values out — which is what makes Next's last-occurrence-wins segment key
    // lossless for this page (#345).
    const values = ["upper legs", "lower arms", "cardio"];
    expect(splitFacetValues(joinFacetValues(values))).toEqual(values);
  });

  it("uses a separator no catalog facet value contains", () => {
    // `bodyPart`/`equipment`/`target` values are catalog terms such as
    // "body weight" and "upper legs" — spaces, never commas. A value that DID
    // contain the separator would split into two terms that each match
    // nothing, which is a narrower result, never a crash.
    expect(FACET_VALUE_SEPARATOR).toBe(",");
    expect("body weight".includes(FACET_VALUE_SEPARATOR)).toBe(false);
  });
});
