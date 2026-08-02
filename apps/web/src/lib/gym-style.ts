import type { BrandingPalette } from "@kinora/contracts";

/**
 * Builds the server-rendered inline `<style>` body injecting the
 * `--gym-*` custom properties (16a-v3-gym-white-label, Slice 4 design
 * decision: "On-the-fly CSS via server-rendered inline `<style>`").
 *
 * Only fields with a value are emitted — `globals.css` consumes each one
 * via `var(--gym-x, var(--default))`, so an absent/null field simply falls
 * back to the default kInorA token with no special-casing here.
 */
export function buildGymStyleBlock(palette: BrandingPalette): string {
  const declarations: Array<[string, string | null]> = [
    ["--gym-accent", palette.accent],
    ["--gym-accent-fg", palette.accentFg],
    ["--gym-surface", palette.surface],
    ["--gym-surface-2", palette.surface2],
    ["--gym-fg", palette.fg],
    ["--gym-muted", palette.muted],
  ];

  const body = declarations
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([name, value]) => `${name}:${value};`)
    .join("");

  return `:root{${body}}`;
}
