/**
 * Inline SVG glyphs for the mobile auth screens (kno/kInorA#445).
 *
 * Same shape as `screens/tracker/icons.tsx`: pure, static, prop-less
 * presentational marks with their colours sourced from the shared theme
 * tokens. The Google mark keeps Google's own brand colours, which is the one
 * place a literal is correct — a brand mark recoloured to the app palette is
 * no longer that brand's mark.
 */

import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { colors } from "../../theme/tokens";

/** The kInorA orbit mark, as drawn in `mobile-auth.html`'s brand row. */
export const BrandMark = () => (
  <Svg width={28} height={28} viewBox="0 0 48 48">
    <Rect width={48} height={48} rx={11} fill={colors.surface} />
    <Circle cx={24} cy={25} r={12.5} fill="none" stroke={colors.muted} strokeWidth={5} />
    <Circle cx={24} cy={11} r={8} fill={colors.accent} />
  </Svg>
);

export const GoogleMark = () => (
  <Svg width={16} height={16} viewBox="0 0 48 48">
    <Path
      fill="#EA4335"
      d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.7l7.8 6.1C12.3 14 17.6 9.5 24 9.5z"
    />
    <Path
      fill="#4285F4"
      d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.6 3-2.3 5.6-4.8 7.3l7.6 5.9c4.4-4.1 7-10.1 7-17.5z"
    />
    <Path
      fill="#FBBC05"
      d="M10.4 28.4a14.6 14.6 0 010-8.6l-7.8-6.1a23.5 23.5 0 000 20.8l7.8-6.1z"
    />
    <Path
      fill="#34A853"
      d="M24 47.5c6.2 0 11.5-2 15.5-5.6l-7.6-5.9c-2.1 1.4-4.8 2.3-7.9 2.3-6.4 0-11.7-4.5-13.6-10.3l-7.8 6.1C6.5 42.1 14.6 47.5 24 47.5z"
    />
  </Svg>
);

/** The leading mark on the error banner and on each inline field hint. */
export const AlertMark = ({ size = 15 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx={12} cy={12} r={9} fill="none" stroke={colors.danger} strokeWidth={2} />
    <Path
      d="M12 8v5M12 16.5v.01"
      fill="none"
      stroke={colors.danger}
      strokeWidth={2}
      strokeLinecap="round"
    />
  </Svg>
);
