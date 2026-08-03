/**
 * Client-safe branding-studio constants, palette metadata, and pure helpers
 * (16a-v3-gym-white-label — Branding Studio).
 *
 * Intentionally FREE of `import "server-only"`: this module is imported by
 * both the server-only `branding-client.ts` and the client component
 * `BrandingStudio.tsx`, so keeping the pure types/enums/helpers here is what
 * lets the browser bundle import them without tripping `ui-api-guard`.
 *
 * `scopedGymStyle` REUSES the SAME `buildGymStyleBlock` builder the login page
 * (Slice 4) and the `(app)` root layout (Slice 5) use to turn a palette into
 * `--gym-*` custom properties — it only re-scopes the emitted rule from the
 * global `:root` to a preview container selector so the studio can theme the
 * live preview WITHOUT re-theming the real app chrome while editing.
 */

import type { BrandingPalette } from "@kinora/contracts";
import { buildGymStyleBlock } from "@/lib/gym-style";

/** The six palette token keys (mirrors `BrandingPalette`, `palette.ts`). */
export type PaletteTokenKey = keyof BrandingPalette;

/** Meaningful UI grouping for the six tokens. */
export type PaletteGroup = "brand" | "surfaces" | "text";

export interface PaletteTokenMeta {
  key: PaletteTokenKey;
  group: PaletteGroup;
  /** i18n key suffix under `brandingStudio.tokens.*`. */
  labelKey: string;
}

/**
 * The six tokens in their canonical order (same order as `palette.ts`'s
 * `PALETTE_FIELDS`), each tagged with its UI group and i18n label key.
 */
export const PALETTE_TOKENS: readonly PaletteTokenMeta[] = [
  { key: "accent", group: "brand", labelKey: "accent" },
  { key: "accentFg", group: "brand", labelKey: "accentFg" },
  { key: "surface", group: "surfaces", labelKey: "surface" },
  { key: "surface2", group: "surfaces", labelKey: "surface2" },
  { key: "fg", group: "text", labelKey: "fg" },
  { key: "muted", group: "text", labelKey: "muted" },
] as const;

/** All-null palette — the "no overrides" baseline (falls back to kInorA defaults). */
export const EMPTY_PALETTE: BrandingPalette = {
  accent: null,
  accentFg: null,
  surface: null,
  surface2: null,
  fg: null,
  muted: null,
};

/**
 * Hex approximations of the kInorA default OKLch tokens (`globals.css`
 * `:root`). Used ONLY as the swatch/color-input display value when a token is
 * `null` (an unset override) — the persisted value stays `null`, so the real
 * theme still resolves through the `var(--gym-x, <oklch default>)` fallback.
 */
export const DEFAULT_PALETTE_HEX: Record<PaletteTokenKey, string> = {
  accent: "#c4f542",
  accentFg: "#0a0a0b",
  surface: "#141416",
  surface2: "#1d1d20",
  fg: "#f4f4f5",
  muted: "#9a9aa0",
};

export interface BrandingPreset {
  /** i18n key suffix under `brandingStudio.presets.*`. */
  id: string;
  palette: Record<PaletteTokenKey, string>;
}

/** Curated one-click starting points, each fully specifying the six tokens. */
export const BRANDING_PRESETS: readonly BrandingPreset[] = [
  {
    id: "lime",
    palette: {
      accent: "#c4f542",
      accentFg: "#0a0a0b",
      surface: "#141416",
      surface2: "#1d1d20",
      fg: "#f4f4f5",
      muted: "#9a9aa0",
    },
  },
  {
    id: "ember",
    palette: {
      accent: "#ff6b35",
      accentFg: "#1a0f08",
      surface: "#1a1310",
      surface2: "#241a15",
      fg: "#f7ede8",
      muted: "#b89b8c",
    },
  },
  {
    id: "ocean",
    palette: {
      accent: "#38bdf8",
      accentFg: "#04121c",
      surface: "#0c1620",
      surface2: "#132433",
      fg: "#e6f3fb",
      muted: "#8aa6ba",
    },
  },
] as const;

/**
 * Subdomain slug rule: 1–32 chars, lowercase alphanumeric with internal
 * hyphens only (no leading/trailing hyphen). Mirrors the class of value the
 * public `by-slug` lookup and the tenant-branding unique index expect.
 */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/** The public host template the live URL chip renders around a slug. */
export const SUBDOMAIN_HOST = "kinora.aitsai.com";

// ---------------------------------------------------------------------------
// WCAG-ish contrast (sRGB relative luminance → contrast ratio)
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((c) => c + c).join("")
    : normalized;
  const int = Number.parseInt(value, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio (1..21) between two `#rrggbb` colors. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(hexToRgb(a));
  const lb = relativeLuminance(hexToRgb(b));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** True when the pair clears the WCAG AA body-text threshold (4.5:1). */
export function hasSufficientContrast(a: string, b: string): boolean {
  return contrastRatio(a, b) >= 4.5;
}

/** The hex to display in a swatch for `key`: the override, else the default. */
export function resolveSwatchHex(key: PaletteTokenKey, palette: BrandingPalette): string {
  return palette[key] ?? DEFAULT_PALETTE_HEX[key];
}

/**
 * REUSE of `buildGymStyleBlock`, re-scoped from the global `:root` to a
 * container selector so the studio themes ONLY the live preview (never the
 * real app chrome) while the gym owner edits. An all-null palette yields an
 * empty rule body (`<selector>{}`), so a reset visibly falls back to defaults.
 */
export function scopedGymStyle(palette: BrandingPalette, selector: string): string {
  return buildGymStyleBlock(palette).replace(":root", selector);
}
