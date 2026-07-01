import { describe, expect, it } from "vitest";
import {
  SESSION_DURATION_LIMITS,
  validateSessionDuration,
} from "../session-duration.js";

describe("session duration domain rules", () => {
  it("exposes inclusive minute bounds", () => {
    expect(SESSION_DURATION_LIMITS.min).toBe(15);
    expect(SESSION_DURATION_LIMITS.max).toBe(240);
  });

  it("accepts an in-range integer duration", () => {
    expect(validateSessionDuration(60)).toEqual({ ok: true, minutes: 60 });
  });

  it("accepts the exact lower and upper bounds", () => {
    expect(validateSessionDuration(15)).toEqual({ ok: true, minutes: 15 });
    expect(validateSessionDuration(240)).toEqual({ ok: true, minutes: 240 });
  });

  it("rejects zero", () => {
    const result = validateSessionDuration(0);
    expect(result.ok).toBe(false);
  });

  it("rejects negative values", () => {
    const result = validateSessionDuration(-30);
    expect(result.ok).toBe(false);
  });

  it("rejects values below the minimum", () => {
    const result = validateSessionDuration(10);
    expect(result.ok).toBe(false);
  });

  it("rejects values above the maximum", () => {
    const result = validateSessionDuration(300);
    expect(result.ok).toBe(false);
  });

  it("rejects non-integer values", () => {
    const result = validateSessionDuration(45.5);
    expect(result.ok).toBe(false);
  });

  it("rejects NaN and non-finite values", () => {
    expect(validateSessionDuration(Number.NaN).ok).toBe(false);
    expect(validateSessionDuration(Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it("returns a descriptive reason on rejection", () => {
    const result = validateSessionDuration(0);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toMatch(/between 15 and 240/i);
  });
});
