import { describe, expect, it } from "vitest";
import { validateRpe } from "../plan/rpe.js";

describe("RPE domain rules", () => {
  it("accepts inclusive RPE bounds and a typical in-range value", () => {
    expect(validateRpe(0)).toEqual({ ok: true, rpe: 0 });
    expect(validateRpe(5)).toEqual({ ok: true, rpe: 5 });
    expect(validateRpe(10)).toEqual({ ok: true, rpe: 10 });
  });

  it("rejects values below the minimum or above the maximum", () => {
    expect(validateRpe(-1).ok).toBe(false);
    expect(validateRpe(11).ok).toBe(false);
  });

  it("rejects non-numeric values", () => {
    expect(validateRpe("5").ok).toBe(false);
    expect(validateRpe(Number.NaN).ok).toBe(false);
    expect(validateRpe(Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it("returns a descriptive reason on rejection", () => {
    const result = validateRpe(12);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toMatch(/0 and 10/i);
  });
});
