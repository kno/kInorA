import { describe, expect, it } from "vitest";
import { delta } from "./delta.js";

describe("delta", () => {
  it("returns the percentage change vs. the previous period", () => {
    expect(delta(120, 100)).toBe(20);
    expect(delta(80, 100)).toBe(-20);
  });

  it("returns null when the previous period is zero (never divide-by-zero)", () => {
    expect(delta(50, 0)).toBeNull();
  });

  it("returns null when the previous period is absent (undefined)", () => {
    expect(delta(50, undefined)).toBeNull();
  });

  it("returns null when the previous period is absent (null)", () => {
    expect(delta(50, null)).toBeNull();
  });

  it("returns 0 when current equals previous", () => {
    expect(delta(100, 100)).toBe(0);
  });

  it("never returns Infinity, -Infinity, or NaN for any input", () => {
    const cases: Array<[number, number | null | undefined]> = [
      [0, 0],
      [0, undefined],
      [100, 0],
      [-5, 0],
    ];
    for (const [current, previous] of cases) {
      const result = delta(current, previous);
      expect(Number.isFinite(result) || result === null).toBe(true);
      expect(result).not.toBeNaN();
    }
  });
});
