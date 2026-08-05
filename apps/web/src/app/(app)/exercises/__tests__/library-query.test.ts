import { describe, it, expect } from "vitest";
import { MAX_EXERCISE_SEARCH_LENGTH as CONTRACT_SEARCH_CAP } from "@kinora/contracts";
import {
  EXERCISE_PAGE_SIZE,
  MAX_EXERCISE_OFFSET,
  MAX_EXERCISE_SEARCH_LENGTH,
  normalizeLibraryParams,
  pageHref,
  parseOffset,
  preservedSearchParams,
  carriedFilterParams,
} from "../library-query";

describe("EXERCISE_PAGE_SIZE", () => {
  it("is a bounded window — the ~1300-record catalog is never shipped whole", () => {
    expect(EXERCISE_PAGE_SIZE).toBeGreaterThan(0);
    expect(EXERCISE_PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});

describe("MAX_EXERCISE_SEARCH_LENGTH", () => {
  it("IS the API's cap, not a second copy of the number", () => {
    // A local literal drifts silently: the moment the API lowered its cap, this
    // layer would keep sending terms the API 400s on, and the page would claim
    // the library is unavailable. Same single-source-of-truth treatment
    // `EXERCISE_BODY_PARTS` already gets.
    expect(MAX_EXERCISE_SEARCH_LENGTH).toBe(CONTRACT_SEARCH_CAP);
    expect(typeof CONTRACT_SEARCH_CAP).toBe("number");
  });
});

describe("normalizeLibraryParams", () => {
  it("passes a single-value parameter through untouched", () => {
    expect(
      normalizeLibraryParams({
        title: "Bench Press",
        search: "press",
        offset: "24",
      }),
    ).toEqual({
      title: "Bench Press",
      search: "press",
      offset: "24",
    });
  });

  it("collapses a REPEATED single-value key to its first value (the App Router sends an array)", () => {
    // `?search=press&search=squat` reaches the page as `["press", "squat"]`.
    // Anything downstream that called `.trim()` on that threw a TypeError
    // outside the action's try/catch, and the whole page answered HTTP 500.
    expect(
      normalizeLibraryParams({
        search: ["press", "squat"],
      }),
    ).toEqual({
      search: "press",
    });
  });

  it("drops an empty array and a blank single value rather than emitting a blank filter", () => {
    expect(normalizeLibraryParams({ search: [] })).toEqual({});
    expect(normalizeLibraryParams({ title: "   " })).toEqual({});
  });

  it("SKIPS a blank first value when a single-value key repeats, instead of losing the filter", () => {
    // `?search=&search=press` arrives as `["", "press"]`. Returning `raw[0]`
    // gave `""` — falsy — so the key was never set and the page answered with
    // the WHOLE unfiltered library (1324 records instead of 164). A quiet wrong
    // answer, which is worse than the loud 500 this normalisation replaced.
    expect(normalizeLibraryParams({ search: ["", "press"] })).toEqual({ search: "press" });
  });

  it("still means NO filter when every repeated single value is blank", () => {
    expect(normalizeLibraryParams({ search: ["", "   "] })).toEqual({});
  });

  it("truncates a search term the API would reject as oversized", () => {
    const term = "a".repeat(MAX_EXERCISE_SEARCH_LENGTH + 50);
    expect(normalizeLibraryParams({ search: term }).search).toHaveLength(
      MAX_EXERCISE_SEARCH_LENGTH,
    );
  });

  it("carries an unrelated parameter such as ?lang= through", () => {
    expect(normalizeLibraryParams({ lang: "es", search: "press" })).toEqual({
      lang: "es",
      search: "press",
    });
  });

  // --- Design §5: bodyPart/equipment/target take the MULTI-VALUE path ---

  describe("multi-value facet fields (bodyPart, equipment, target)", () => {
    it("omits the key entirely when absent (`?k=` never sent)", () => {
      expect(normalizeLibraryParams({})).toEqual({});
    });

    it("resolves a single value to a one-element array", () => {
      expect(normalizeLibraryParams({ bodyPart: "chest" })).toEqual({ bodyPart: ["chest"] });
    });

    it("resolves `?k=&k=b` to `[\"b\"]` — a blank alongside a value never loses the filter", () => {
      expect(normalizeLibraryParams({ equipment: ["", "barbell"] })).toEqual({
        equipment: ["barbell"],
      });
    });

    it("resolves `?k=a&k=a` to `[\"a\"]` — duplicates are deduplicated", () => {
      expect(normalizeLibraryParams({ target: ["abs", "abs"] })).toEqual({ target: ["abs"] });
    });

    it("resolves `?k= a ` to `[\"a\"]` — trimmed", () => {
      expect(normalizeLibraryParams({ equipment: " barbell " })).toEqual({
        equipment: ["barbell"],
      });
    });

    it("omits the key when every repeated value is blank (`?k=&k=` behaves like absent)", () => {
      expect(normalizeLibraryParams({ target: ["", "   "] })).toEqual({});
    });

    it("preserves URL order across multiple distinct values", () => {
      expect(normalizeLibraryParams({ bodyPart: ["chest", "cardio", "back"] })).toEqual({
        bodyPart: ["chest", "cardio", "back"],
      });
    });

    it("drops a bodyPart value outside the API enum instead of forcing a 400, keeping the survivors", () => {
      // The API enum is lowercase; `?bodyPart=Chest` is a 400, which the page
      // would render as "the library is unavailable" — a lie. This is the
      // #345 shield extended to the array case: unknown members are filtered
      // out, not the whole selection.
      expect(normalizeLibraryParams({ bodyPart: ["Chest", "cardio"] })).toEqual({
        bodyPart: ["cardio"],
      });
    });

    it("omits bodyPart entirely when none of the values survive the enum filter", () => {
      expect(normalizeLibraryParams({ bodyPart: "Chest" })).toEqual({});
    });

    it("does not enum-filter equipment/target — they are free-form", () => {
      expect(normalizeLibraryParams({ equipment: "exosuit" })).toEqual({
        equipment: ["exosuit"],
      });
    });
  });
});

describe("parseOffset", () => {
  it("defaults to zero for an absent, non-numeric, negative or fractional value", () => {
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset("abc")).toBe(0);
    expect(parseOffset("-5")).toBe(0);
    expect(parseOffset("1.5")).toBe(0);
  });

  it("accepts a non-negative integer", () => {
    expect(parseOffset("48")).toBe(48);
    expect(parseOffset("0")).toBe(0);
  });

  it("bounds an absurd offset, so String(offset) stays a plain digit string", () => {
    // `Number("1000000000000000000000")` is an integer, but `String()` of it is
    // `"1e+21"` — which fails the API's `^\d+$` regex and 400s, surfacing as
    // the "library unavailable" card.
    const clamped = parseOffset("1000000000000000000000");
    expect(clamped).toBe(MAX_EXERCISE_OFFSET);
    expect(String(clamped)).toMatch(/^\d+$/);
  });
});

describe("preservedSearchParams", () => {
  it("returns nothing when no filter is active", () => {
    expect(preservedSearchParams({})).toEqual([]);
  });

  it("carries the history selection", () => {
    expect(preservedSearchParams({ title: "Bench Press" })).toEqual([["title", "Bench Press"]]);
  });

  it("EXCLUDES search — the text input contributes that itself", () => {
    expect(preservedSearchParams({ search: "press", title: "Bench Press" })).toEqual([
      ["title", "Bench Press"],
    ]);
  });

  it("EXCLUDES offset — a new search restarts at page 1", () => {
    expect(preservedSearchParams({ offset: "48", title: "Bench Press" })).toEqual([
      ["title", "Bench Press"],
    ]);
  });

  it("EXCLUDES bodyPart/equipment/target — the checkboxes inside the same form contribute those", () => {
    // Design §7: the facet checkboxes now live INSIDE the search form, so the
    // hidden fields must not duplicate what the checkboxes already submit —
    // that would double-send a stale value alongside the live one.
    expect(
      preservedSearchParams({
        title: "Bench Press",
        bodyPart: ["chest"],
        equipment: ["barbell"],
        target: ["pectorals"],
      }),
    ).toEqual([["title", "Bench Press"]]);
  });

  it("carries ?lang= so a submit does not silently switch the reader's locale", () => {
    expect(preservedSearchParams({ lang: "es", title: "Bench Press" })).toEqual([
      ["title", "Bench Press"],
      ["lang", "es"],
    ]);
  });

  it("does NOT reflect an unrelated third-party parameter into a hidden field", () => {
    // `?utm_source=newsletter` rendered
    // `<input type="hidden" name="utm_source" value="newsletter">` inside the
    // library's own search form. Only `lang` was ever required to survive;
    // carrying everything turned arbitrary query junk into our markup.
    expect(
      preservedSearchParams({ utm_source: "newsletter", ref: "twitter", title: "Bench Press" }),
    ).toEqual([["title", "Bench Press"]]);
  });
});

describe("pageHref", () => {
  it("returns the bare route for page one with no filters", () => {
    expect(pageHref({}, 0)).toBe("/exercises");
  });

  it("omits a zero offset but keeps the filters", () => {
    expect(pageHref({ search: "press" }, 0)).toBe("/exercises?search=press");
  });

  it("keeps the active filters and the history selection", () => {
    expect(pageHref({ search: "press", bodyPart: ["chest"], title: "Bench Press" }, 24)).toBe(
      "/exercises?title=Bench+Press&search=press&bodyPart=chest&offset=24",
    );
  });

  it("carries ?lang= to the next page, so page 2 keeps the reader's locale", () => {
    expect(pageHref({ lang: "es", search: "press" }, 24)).toBe(
      "/exercises?search=press&lang=es&offset=24",
    );
  });

  it("does NOT echo an unrelated third-party parameter into the pager link", () => {
    expect(pageHref({ utm_source: "newsletter", search: "press" }, 24)).toBe(
      "/exercises?search=press&offset=24",
    );
  });

  it("carries every filter field", () => {
    const href = pageHref({ equipment: ["barbell"], target: ["pectorals"] }, 48);
    expect(href).toContain("equipment=barbell");
    expect(href).toContain("target=pectorals");
    expect(href).toContain("offset=48");
  });

  it("serializes MULTIPLE values of the same facet as repeated pairs, in URL order", () => {
    const href = pageHref({ bodyPart: ["cardio", "chest"] }, 0);
    expect(href).toBe("/exercises?bodyPart=cardio&bodyPart=chest");
  });
});

describe("carriedFilterParams", () => {
  it("carries everything active EXCEPT offset, so a filter change restarts at page 1", () => {
    const carried = carriedFilterParams({
      title: "Bench Press",
      search: "press",
      bodyPart: ["chest"],
      offset: "48",
      lang: "es",
    });

    expect(carried).toEqual([
      ["title", "Bench Press"],
      ["search", "press"],
      ["bodyPart", "chest"],
      ["lang", "es"],
    ]);
  });

  it("KEEPS the search, unlike the form's hidden fields", () => {
    // The chip href is a complete destination URL; nothing else contributes
    // the term to it, so dropping `search` here would silently clear the
    // reader's search every time they touched a filter.
    const params = { search: "press", bodyPart: ["chest"] };

    expect(carriedFilterParams(params)).toContainEqual(["search", "press"]);
    expect(preservedSearchParams(params).some(([key]) => key === "search")).toBe(false);
  });

  it("carries EVERY value of a multi-select facet, in URL order — the Object.fromEntries trap", () => {
    // `Object.fromEntries` silently keeps only the LAST of repeated keys.
    // This is the exact bug the return-type change (Record → tuple array)
    // exists to make impossible: the compiler forces every call site that
    // still expects a Record to be revisited.
    expect(carriedFilterParams({ bodyPart: ["cardio", "chest"] })).toEqual([
      ["bodyPart", "cardio"],
      ["bodyPart", "chest"],
    ]);
  });

  it("does not echo unrelated third-party query junk into the chip links", () => {
    expect(carriedFilterParams({ utm_source: "newsletter", bodyPart: ["chest"] })).toEqual([
      ["bodyPart", "chest"],
    ]);
  });

  it("is empty when nothing is applied", () => {
    expect(carriedFilterParams({})).toEqual([]);
  });
});
