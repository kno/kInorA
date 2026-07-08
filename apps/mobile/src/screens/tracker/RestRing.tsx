/**
 * Rest-timer countdown ring (SVG).
 *
 * Presentational: renders the track + progress arc for a countdown. The arc
 * starts at 12 o'clock (rotated -90°) and unwinds clockwise as `remaining`
 * drops, matching the Open Design mockup's `stroke-dashoffset` animation.
 * The centered time/label text is overlaid by the parent.
 */

import React from "react";
import Svg, { Circle, G } from "react-native-svg";
import { ringDashoffset } from "./tracker-logic";
import { colors } from "../../theme/tokens";

const SIZE = 130;
const RADIUS = 55;
const STROKE = 8;
const CENTER = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface RestRingProps {
  remaining: number;
  duration: number;
  /** Arc color — amber normally, lime in the final seconds. */
  strokeColor: string;
}

export function RestRing({ remaining, duration, strokeColor }: RestRingProps) {
  const offset = ringDashoffset(remaining, duration, CIRCUMFERENCE);
  return (
    <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <G rotation={-90} origin={`${CENTER}, ${CENTER}`}>
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke={colors.surface2}
          strokeWidth={STROKE}
        />
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke={strokeColor}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
        />
      </G>
    </Svg>
  );
}

export const REST_RING_SIZE = SIZE;
