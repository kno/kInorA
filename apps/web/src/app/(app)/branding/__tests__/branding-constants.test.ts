import { describe, it, expect } from "vitest";
import {
  PALETTE_TOKENS,
  EMPTY_PALETTE,
  DEFAULT_PALETTE_HEX,
  BRANDING_PRESETS,
  isValidSlug,
  contrastRatio,
  hasSufficientContrast,
  scopedGymStyle,
  resolveSwatchHex,
} from "../branding-constants.js";

describe("PALETTE_TOKENS", () => {
  it("enumerates the six branding tokens across three groups", () => {
    const keys = PALETTE_TOKENS.map((t) => t.key);
    expect(keys).toEqual(["accent", "accentFg", "surface", "surface2", "fg", "muted"]);
    expect(new Set(PALETTE_TOKENS.map((t) => t.group))).toEqual(new Set(["brand", "surfaces", "text"]));
  });
});

describe("EMPTY_PALETTE", () => {
  it("is all-null (the null-override baseline that falls back to kInorA defaults)", () => {
    expect(EMPTY_PALETTE).toEqual({
      accent: null,
      accentFg: null,
      surface: null,
      surface2: null,
      fg: null,
      muted: null,
    });
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase alphanumeric + internal hyphens (1-32 chars)", () => {
    expect(isValidSlug("acme")).toBe(true);
    expect(isValidSlug("acme-gym-01")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
  });

  it("rejects uppercase, leading/trailing hyphens, spaces, and over-length", () => {
    expect(isValidSlug("Acme")).toBe(false);
    expect(isValidSlug("-acme")).toBe(false);
    expect(isValidSlug("acme-")).toBe(false);
    expect(isValidSlug("acme gym")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("a".repeat(33))).toBe(false);
  });
});

describe("contrastRatio", () => {
  it("returns 21 for black on white and 1 for identical colors", () => {
    expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });

  it("hasSufficientContrast flags a low-contrast pair and passes a high-contrast pair", () => {
    expect(hasSufficientContrast("#000000", "#ffffff")).toBe(true);
    expect(hasSufficientContrast("#777777", "#808080")).toBe(false);
  });
});

describe("scopedGymStyle", () => {
  it("reuses buildGymStyleBlock but scopes the vars to the given selector", () => {
    const css = scopedGymStyle({ ...EMPTY_PALETTE, accent: "#ff0000" }, ".brand-preview");
    expect(css).toContain(".brand-preview{");
    expect(css).toContain("--gym-accent:#ff0000;");
    expect(css).not.toContain(":root");
  });

  it("emits an empty rule body for an all-null (reset) palette", () => {
    const css = scopedGymStyle(EMPTY_PALETTE, ".brand-preview");
    expect(css).toBe(".brand-preview{}");
  });
});

describe("resolveSwatchHex", () => {
  it("returns the token value when set, else the kInorA default swatch hex", () => {
    expect(resolveSwatchHex("accent", { ...EMPTY_PALETTE, accent: "#abcdef" })).toBe("#abcdef");
    expect(resolveSwatchHex("accent", EMPTY_PALETTE)).toBe(DEFAULT_PALETTE_HEX.accent);
  });
});

describe("BRANDING_PRESETS", () => {
  it("ships at least two curated presets, each fully specifying the six tokens", () => {
    expect(BRANDING_PRESETS.length).toBeGreaterThanOrEqual(2);
    for (const preset of BRANDING_PRESETS) {
      for (const token of PALETTE_TOKENS) {
        expect(preset.palette[token.key]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});
