import { describe, expect, it } from "vitest";
import { isValidHexColor, validatePalette } from "../palette.js";

/**
 * Gym white-label branding palette validation (16a-v3-gym-white-label,
 * Slice 1, tasks 1.6/1.7). Pure functions, no DB/route dependency: the same
 * `^#[0-9a-fA-F]{6}$` rule the DB CHECK constraint enforces (schema.ts), so an
 * invalid value is rejected at the application layer before ever reaching a
 * write (the CRUD route in Slice 3 will call `validatePalette`).
 */
describe("isValidHexColor", () => {
  it("accepts a well-formed 6-digit hex color", () => {
    expect(isValidHexColor("#112233")).toBe(true);
    expect(isValidHexColor("#AABBCC")).toBe(true);
  });

  it("rejects a malformed hex color", () => {
    expect(isValidHexColor("112233")).toBe(false); // missing '#'
    expect(isValidHexColor("#12345")).toBe(false); // too short
    expect(isValidHexColor("#gggggg")).toBe(false); // non-hex chars
    expect(isValidHexColor("")).toBe(false);
  });

  it("accepts null as a valid absent value", () => {
    expect(isValidHexColor(null)).toBe(true);
  });
});

describe("validatePalette", () => {
  it("returns valid: true for a full palette of well-formed hex colors", () => {
    const result = validatePalette({
      accent: "#112233",
      accentFg: "#445566",
      surface: "#778899",
      surface2: "#aabbcc",
      fg: "#ddeeff",
      muted: "#001122",
    });
    expect(result).toEqual({ valid: true });
  });

  it("returns valid: false naming the first malformed field", () => {
    const result = validatePalette({
      accent: "#112233",
      accentFg: "not-a-hex",
      surface: null,
      surface2: null,
      fg: null,
      muted: null,
    });
    expect(result).toEqual({ valid: false, invalidField: "accentFg" });
  });

  it("treats null fields as valid (absent, falls back to default tokens)", () => {
    const result = validatePalette({
      accent: null,
      accentFg: null,
      surface: null,
      surface2: null,
      fg: null,
      muted: null,
    });
    expect(result).toEqual({ valid: true });
  });
});
