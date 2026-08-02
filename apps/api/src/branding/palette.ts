import type { BrandingPalette } from "@kinora/contracts";

/**
 * Gym white-label branding palette validation (16a-v3-gym-white-label,
 * Slice 1). Pure functions mirroring the `tenant_branding` DB CHECK
 * constraint (`^#[0-9a-fA-F]{6}$` per hex column, `schema.ts`) so an invalid
 * value is rejected at the application layer before ever reaching a write.
 * Not wired into any route in this slice — the gated CRUD route in Slice 3
 * calls `validatePalette` before persisting.
 */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** True for a well-formed `#RRGGBB` hex color, or `null` (a valid absent value). */
export function isValidHexColor(value: string | null): boolean {
  if (value === null) return true;
  return HEX_COLOR_PATTERN.test(value);
}

export type PaletteValidationResult =
  | { valid: true }
  | { valid: false; invalidField: keyof BrandingPalette };

const PALETTE_FIELDS: Array<keyof BrandingPalette> = [
  "accent",
  "accentFg",
  "surface",
  "surface2",
  "fg",
  "muted",
];

/**
 * Validates every field of a {@link BrandingPalette}, returning the first
 * malformed field name so a caller (the Slice 3 CRUD route) can surface a
 * precise HTTP 400 without persisting or updating the branding row.
 */
export function validatePalette(palette: BrandingPalette): PaletteValidationResult {
  for (const field of PALETTE_FIELDS) {
    if (!isValidHexColor(palette[field])) {
      return { valid: false, invalidField: field };
    }
  }
  return { valid: true };
}
