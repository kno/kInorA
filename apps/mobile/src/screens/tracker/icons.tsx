/**
 * Inline SVG icons for the workout tracker screen and its children.
 *
 * Pure, static presentational glyphs — no props, colors sourced from the
 * shared theme tokens so they track the app palette. Extracted from
 * `WorkoutTrackerScreen` so each tracker component can import only the icons
 * it renders.
 */

import React from "react";
import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";

import { colors } from "../../theme/tokens";

export const PauseIcon = () => (
  <Svg width={16} height={16} viewBox="0 0 16 16">
    <Rect x={3} y={2} width={4} height={12} rx={1.5} fill={colors.muted} />
    <Rect x={9} y={2} width={4} height={12} rx={1.5} fill={colors.muted} />
  </Svg>
);
export const PlayIcon = () => (
  <Svg width={16} height={16} viewBox="0 0 16 16">
    <Polygon points="3,2 14,8 3,14" fill={colors.muted} />
  </Svg>
);
export const MinusIcon = () => (
  <Svg width={16} height={16} viewBox="0 0 16 16">
    <Line x1={3} y1={8} x2={13} y2={8} stroke={colors.fg} strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);
export const PlusIcon = () => (
  <Svg width={16} height={16} viewBox="0 0 16 16">
    <Line x1={8} y1={3} x2={8} y2={13} stroke={colors.fg} strokeWidth={2.2} strokeLinecap="round" />
    <Line x1={3} y1={8} x2={13} y2={8} stroke={colors.fg} strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);
export const CheckIcon = () => (
  <Svg width={18} height={18} viewBox="0 0 18 18">
    <Polyline points="3,9 7.5,13.5 15,4" fill="none" stroke={colors.accentFg} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const PersonIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 22 22">
    <Circle cx={11} cy={7} r={3} fill="none" stroke={colors.muted} strokeWidth={1.8} />
    <Path d="M5 19c0-3.3 2.7-6 6-6s6 2.7 6 6" fill="none" stroke={colors.muted} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
export const ChevronIcon = () => (
  <Svg width={18} height={18} viewBox="0 0 18 18">
    <Polyline points="7,4 13,9 7,14" fill="none" stroke={colors.muted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const StopIcon = () => (
  <Svg width={15} height={15} viewBox="0 0 15 15">
    <Rect x={2} y={2} width={11} height={11} rx={2} fill="none" stroke={colors.danger} strokeWidth={2} />
  </Svg>
);
