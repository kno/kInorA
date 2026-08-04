import { describe, it, expect } from "vitest";
import {
  EXERCISE_PAGE_SIZE,
  pageHref,
  parseOffset,
  preservedSearchParams,
} from "../library-query";

describe("EXERCISE_PAGE_SIZE", () => {
  it("is a bounded window — the ~1300-record catalog is never shipped whole", () => {
    expect(EXERCISE_PAGE_SIZE).toBeGreaterThan(0);
    expect(EXERCISE_PAGE_SIZE).toBeLessThanOrEqual(100);
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
});

describe("preservedSearchParams", () => {
  it("returns nothing when no filter is active", () => {
    expect(preservedSearchParams({})).toEqual({});
  });

  it("carries every active filter plus the history selection", () => {
    expect(
      preservedSearchParams({
        title: "Bench Press",
        bodyPart: "chest",
        equipment: "barbell",
        target: "pectorals",
      }),
    ).toEqual({
      title: "Bench Press",
      bodyPart: "chest",
      equipment: "barbell",
      target: "pectorals",
    });
  });

  it("EXCLUDES search — the text input contributes that itself", () => {
    expect(preservedSearchParams({ search: "press", bodyPart: "chest" })).toEqual({
      bodyPart: "chest",
    });
  });

  it("EXCLUDES offset — a new search restarts at page 1", () => {
    expect(preservedSearchParams({ offset: "48", bodyPart: "chest" })).toEqual({
      bodyPart: "chest",
    });
  });

  it("drops blank values so the form never emits an empty parameter", () => {
    expect(preservedSearchParams({ bodyPart: "", target: "abs" })).toEqual({ target: "abs" });
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
    expect(pageHref({ search: "press", bodyPart: "chest", title: "Bench Press" }, 24)).toBe(
      "/exercises?title=Bench+Press&search=press&bodyPart=chest&offset=24",
    );
  });

  it("carries every filter field", () => {
    const href = pageHref({ equipment: "barbell", target: "pectorals" }, 48);
    expect(href).toContain("equipment=barbell");
    expect(href).toContain("target=pectorals");
    expect(href).toContain("offset=48");
  });
});
