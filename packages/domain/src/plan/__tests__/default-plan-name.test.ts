import { describe, expect, it } from "vitest";
import { defaultPlanName } from "../default-plan-name.js";

const CREATED_AT = new Date("2026-07-06T09:30:00.000Z");

describe("defaultPlanName", () => {
  it("passes a non-blank name through unchanged", () => {
    expect(defaultPlanName("Summer Cut", CREATED_AT)).toBe("Summer Cut");
  });

  it("trims surrounding whitespace on a non-blank name", () => {
    expect(defaultPlanName("  Push Pull Legs  ", CREATED_AT)).toBe("Push Pull Legs");
  });

  it("falls back to a date-based label when name is null", () => {
    expect(defaultPlanName(null, CREATED_AT)).toBe("Plan 2026-07-06");
  });

  it("falls back to a date-based label when name is undefined", () => {
    expect(defaultPlanName(undefined, CREATED_AT)).toBe("Plan 2026-07-06");
  });

  it("falls back to a date-based label when name is an empty string", () => {
    expect(defaultPlanName("", CREATED_AT)).toBe("Plan 2026-07-06");
  });

  it("falls back to a date-based label when name is whitespace only", () => {
    expect(defaultPlanName("   ", CREATED_AT)).toBe("Plan 2026-07-06");
  });

  it("accepts an ISO string createdAt for the date-based fallback", () => {
    expect(defaultPlanName(null, "2026-01-02T00:00:00.000Z")).toBe("Plan 2026-01-02");
  });

  it("uses the UTC calendar date for a near-midnight timestamp (F4 — locks UTC behavior)", () => {
    // 2026-07-06T23:55:00Z is late on Jul 6 in UTC but already Jul 7 in some
    // ahead-of-UTC zones. The label is intentionally UTC-based (deterministic;
    // the DB stores UTC) — this test LOCKS that: it must resolve to Jul 6, NOT
    // a locale-shifted Jul 7.
    expect(defaultPlanName(null, "2026-07-06T23:55:00.000Z")).toBe("Plan 2026-07-06");
    expect(defaultPlanName(null, new Date("2026-07-06T23:55:00.000Z"))).toBe(
      "Plan 2026-07-06",
    );
  });

  it("never returns an empty string across every fallback path", () => {
    for (const input of [null, undefined, "", "   "]) {
      expect(defaultPlanName(input, CREATED_AT).length).toBeGreaterThan(0);
    }
  });
});
