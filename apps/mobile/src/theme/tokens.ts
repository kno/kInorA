/**
 * kInorA mobile design tokens.
 *
 * React Native has no CSS custom properties and its color parser does NOT
 * understand `oklch(...)`, so the design system from `DESIGN.md` (dark-only,
 * near-black canvas, single lime accent, Space Grotesk / DM Sans) is
 * translated here into a plain StyleSheet-friendly theme object.
 *
 * Colors use the hex equivalents documented in DESIGN.md's token table; the
 * alpha variants (tints used for the active progress segment, warning/danger
 * washes) are the oklch `/ alpha` values from the mockup expressed as rgba on
 * the same hex anchors. No new colors are invented.
 */

export const colors = {
  // surfaces (elevation ladder: bg -> surface -> surface2)
  bg: "#09090C",
  surface: "#101014",
  surface2: "#17171C",
  border: "#26262C",
  fg: "#F4F4F5",
  muted: "#9A9AA2",

  // brand accent (lime) — used sparingly, max ~2 per screen
  accent: "#A8F060",
  accentFg: "#09090C",
  /** accent @ 12% — active pill / soft wash (oklch(... / 0.12)). */
  accentDim: "rgba(168, 240, 96, 0.12)",
  /** accent @ 45% — the "active" progress segment (oklch(... / 0.45)). */
  accentActive: "rgba(168, 240, 96, 0.45)",

  // states
  success: "#A8F060",
  warning: "#F0C95F",
  /** warning @ 12% / 25% — the "+15s" button fill / border. */
  warningTint: "rgba(240, 201, 95, 0.12)",
  warningBorder: "rgba(240, 201, 95, 0.25)",
  warningTintHover: "rgba(240, 201, 95, 0.18)",
  danger: "#F0605F",
  /** danger @ 40% / 8% — the "Finalizar sesión" outline / pressed wash. */
  dangerBorder: "rgba(240, 96, 95, 0.4)",
  dangerTint: "rgba(240, 96, 95, 0.08)",
  info: "#60A8F0",
} as const;

/**
 * Font family keys. These strings MUST match the keys registered in
 * `useFonts(...)` (see App.tsx). Space Grotesk for display/metrics, DM Sans
 * for body/UI — per DESIGN.md section 3.
 */
export const fonts = {
  display: "SpaceGrotesk-SemiBold",
  displayBold: "SpaceGrotesk-Bold",
  body: "DMSans-Regular",
  bodyMedium: "DMSans-Medium",
  bodySemiBold: "DMSans-SemiBold",
  bodyBold: "DMSans-Bold",
} as const;

/** 8px rhythm (8 / 12 / 16 / 24 / 32 / 48). */
export const spacing = {
  1: 8,
  2: 12,
  3: 16,
  4: 24,
  5: 32,
  6: 48,
} as const;

/** Radii — cards 16-20, buttons/pills 12, chips full. */
export const radius = {
  sm: 10,
  btn: 12,
  md: 14,
  lg: 16,
  card: 18,
  cardLg: 20,
  pill: 999,
} as const;

export const theme = { colors, fonts, spacing, radius } as const;
export type Theme = typeof theme;
